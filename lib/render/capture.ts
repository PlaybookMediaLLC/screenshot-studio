'use client'

import { getCanvasContainer } from '@/components/canvas/ClientCanvas'
import { currentImageMotion } from '@/lib/animation/use-image-motion'
import { getAspectRatioPreset } from '@/lib/aspect-ratio-utils'
import { exportElement } from '@/lib/export/export-service'
import type { StageFormat } from '@/lib/export/formats'
import { captureStageSvg } from '@/lib/export/svg'
import type { QualityPreset } from '@/lib/export/types'
import { useImageStore } from '@/lib/store'

/** The DOM id of the stage every capture reads. */
export const STAGE_ELEMENT_ID = 'image-render-card'

/** What to produce from the stage. Sizes are output pixels. */
export type StageOutput = {
  format: StageFormat
  /** Encode through the image API for smaller files (falls back to the browser). */
  compress?: boolean
  quality?: QualityPreset
  /** Multiple of the canvas size; ignored when `maxWidth` is set. */
  scale?: number
  /** Fit the output inside this width (previews and thumbnails). */
  maxWidth?: number
}

export type StageCapture = { blob: Blob; height: number; width: number }

/** Output pixel size for the current canvas and an output request. */
export function stageOutputSize(
  canvas: { height: number; width: number },
  output: Pick<StageOutput, 'maxWidth' | 'scale'>
): { height: number; scale: number; width: number } {
  if (output.maxWidth) {
    const factor = Math.min(1, output.maxWidth / canvas.width)
    return {
      height: Math.max(1, Math.round(canvas.height * factor)),
      scale: 1,
      width: Math.max(1, Math.round(canvas.width * factor)),
    }
  }
  const scale = output.scale ?? 1
  return { height: canvas.height * scale, scale, width: canvas.width * scale }
}

/** Resolve once every image inside the stage has loaded and decoded. */
export async function waitForStageImages(timeoutMs = 15_000): Promise<void> {
  const stage = document.getElementById(STAGE_ELEMENT_ID)
  if (!stage) return
  const images = Array.from(stage.querySelectorAll('img'))
  const deadline = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))
  await Promise.race([
    Promise.all(images.map((image) => image.decode().catch(() => undefined))),
    deadline,
  ])
}

/** Two frames, so a state change has committed and painted. */
export function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
}

/**
 * Capture the stage as it is drawn now, with the editor's own export: what
 * the stage shows is exactly what this returns.
 */
export async function captureStage(output: StageOutput): Promise<StageCapture> {
  const image = useImageStore.getState()
  const preset = getAspectRatioPreset(image.selectedAspectRatio)
  if (!preset) throw new Error('Unknown aspect ratio.')
  const size = stageOutputSize(preset, output)
  if (output.format === 'svg') {
    const png = () => captureStage({ ...output, format: 'png' }).then((capture) => capture.blob)
    return { blob: await captureStageSvg(STAGE_ELEMENT_ID, size, png), height: size.height, width: size.width }
  }
  const baseWidth = output.maxWidth ? size.width : preset.width
  const baseHeight = output.maxWidth ? size.height : preset.height
  const { blob } = await exportElement(
    STAGE_ELEMENT_ID,
    {
      exportHeight: baseHeight,
      exportWidth: baseWidth,
      format: output.format,
      qualityPreset: output.quality ?? 'high',
      scale: size.scale,
      skipSharp: !output.compress,
    },
    getCanvasContainer(),
    image.backgroundConfig,
    image.backgroundBorderRadius,
    image.textOverlays,
    image.imageOverlays,
    currentImageMotion().perspective3D,
    image.uploadedImageUrl || undefined,
    image.borderRadius,
    image.backgroundBlur,
    image.backgroundNoise,
    image.backgroundConfig.opacity ?? 1
  )
  return { blob, height: size.height, width: size.width }
}
