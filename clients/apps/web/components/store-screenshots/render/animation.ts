'use client'

import { animationLayerSchema, frameAt, frameCount, type AnimationFormat, type AnimationLayer, type FrameState } from '@/lib/store-screenshots/animation/timeline'
import type { AnimationSettings, StoreDocument } from '@/lib/store-screenshots/document/schema'
import { evaluateSlide } from '@/lib/store-screenshots/engine/scene'
import type { TextMeasurer } from '@/lib/store-screenshots/engine/text'
import type { PixelSize } from '@/lib/store-screenshots/targets'
import { FFmpegVideoEncoder } from '@/lib/export/ffmpeg-encoder'
import { isWebCodecsSupported, WebCodecsVideoEncoder } from '@/lib/export/webcodecs-encoder'
import { CaptureAbortedError, renderSceneToCanvas } from './capture'
import type { AssetResolver } from './SlideRender'

/**
 * Animated previews and exports. Each slide is rendered once per layer by
 * the shared renderer at the output size (the layout engine adapts the
 * design to that size), then frames are composited from those layers with
 * the pure timeline. Encoding reuses the editor's WebCodecs MP4 encoder and
 * its FFmpeg GIF encoder.
 */

/** The three rendered layers of one slide. */
export type SlideLayers = Record<AnimationLayer, HTMLCanvasElement>

/** Render every slide's layers at `size`. */
export async function prepareSlideLayers(
  document: StoreDocument,
  slideIndices: number[],
  size: PixelSize,
  locale: string,
  services: { measurer: TextMeasurer; resolveAsset: AssetResolver },
  options: { signal?: AbortSignal; strict?: boolean; onProgress?: (done: number, total: number) => void } = {}
): Promise<SlideLayers[]> {
  const layers: SlideLayers[] = []
  const total = slideIndices.length * 3
  let done = 0
  for (const index of slideIndices) {
    const scene = evaluateSlide(document, index, { size, targetId: 'animation', locale, measurer: services.measurer })
    if (options.strict) {
      const clipped = scene.nodes.find((node) => node.type === 'text' && (node.overflow || node.box.x < 0 || node.box.y < 0 || node.box.x + node.box.width > scene.width || node.box.y + node.box.height > scene.height))
      if (clipped) throw new Error(`Text ${clipped.layerId} clips in this animation size. Adjust its copy, size or placement.`)
    }
    const rendered = {} as SlideLayers
    for (const layer of animationLayerSchema.options) {
      rendered[layer] = await renderSceneToCanvas(scene, services.resolveAsset, { signal: options.signal, only: layer, strict: options.strict })
      done += 1
      options.onProgress?.(done, total)
    }
    layers.push(rendered)
  }
  return layers
}

/** Draw one frame. */
export function drawFrame(context: CanvasRenderingContext2D, frame: FrameState, layers: SlideLayers[], width: number, height: number): void {
  context.save()
  context.fillStyle = '#000000'
  context.fillRect(0, 0, width, height)
  for (const slide of frame.slides) {
    const source = layers[slide.slideIndex]
    if (!source) continue
    context.save()
    context.globalAlpha = slide.slide.opacity
    context.translate(width / 2 + slide.slide.dx * width, height / 2 + slide.slide.dy * height)
    context.scale(slide.slide.scale, slide.slide.scale)
    context.translate(-width / 2, -height / 2)
    context.beginPath()
    context.rect(0, 0, width, height)
    context.clip()
    for (const layer of animationLayerSchema.options) {
      const draw = slide.layers[layer]
      context.save()
      context.globalAlpha *= draw.opacity
      context.translate(width / 2 + draw.dx * width, height / 2 + draw.dy * height)
      context.scale(draw.scale, draw.scale)
      context.translate(-width / 2, -height / 2)
      context.drawImage(source[layer], 0, 0, width, height)
      context.restore()
    }
    context.restore()
  }
  context.restore()
}

/** Encode an animation. Throws `CaptureAbortedError` when cancelled. */
export async function encodeAnimation(
  format: AnimationFormat,
  layers: SlideLayers[],
  settings: AnimationSettings,
  durations: number[],
  size: PixelSize,
  options: { signal: AbortSignal; onProgress?: (fraction: number) => void }
): Promise<Blob> {
  const fps = format === 'gif' ? Math.min(settings.fps, 15) : settings.fps
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) throw new Error('Canvas is not available.')
  const frames = frameCount(durations, fps)

  if (format === 'mp4' && isWebCodecsSupported()) {
    const encoder = new WebCodecsVideoEncoder({ width: size.width, height: size.height, fps, bitrate: 8_000_000, container: 'mp4' })
    try {
      await encoder.initialize()
      for (let index = 0; index < frames; index += 1) {
        if (options.signal.aborted) throw new CaptureAbortedError()
        drawFrame(context, frameAt(settings, durations, index / fps), layers, size.width, size.height)
        await encoder.encodeFromCanvas(canvas, index)
        options.onProgress?.((index + 1) / frames)
      }
      return await encoder.finalize()
    } catch (error) {
      encoder.dispose()
      throw error
    }
  }

  const encoder = new FFmpegVideoEncoder({ width: size.width, height: size.height, fps, format, quality: 'high' })
  try {
    await encoder.initialize()
    for (let index = 0; index < frames; index += 1) {
      if (options.signal.aborted) throw new CaptureAbortedError()
      drawFrame(context, frameAt(settings, durations, index / fps), layers, size.width, size.height)
      await encoder.addFrame(canvas)
      options.onProgress?.(((index + 1) / frames) * 0.6)
    }
    if (options.signal.aborted) throw new CaptureAbortedError()
    options.onProgress?.(0.7)
    return await encoder.encode()
  } catch (error) {
    await encoder.dispose()
    throw error
  }
}
