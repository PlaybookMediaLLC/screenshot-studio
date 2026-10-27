'use client'

import type { TRPCClient } from '@trpc/client'
import type { AppRouter } from '@/lib/trpc/router'
import { fetchDesignSources } from '@/lib/design/open-design'
import { getDesignAssetIds, mapDesignSources } from '@/lib/design/document'
import { renderDocument } from '@/lib/render/scene-renderer'
import { renderAudioMix } from '@/lib/animation/audio-mix'
import { WebCodecsVideoEncoder } from '@/lib/export/webcodecs-encoder'
import { outputFileName, resolvedDocumentHash } from './delivery'
import {
  materializeOutput,
  outputDimensions,
  type CreativeSetDocument,
  type CreativeOutput,
} from './document'

/** Stream exact native timeline frames to the existing encoder; keep only one bitmap in memory. */
export async function renderStoryMotion(
  client: TRPCClient<AppRouter>,
  set: CreativeSetDocument,
  output: CreativeOutput,
  revision: number,
  format: 'mp4' | 'webm',
  signal: AbortSignal,
  onProgress: (value: number) => void
) {
  if (output.review.source || output.review.redactions)
    throw new Error('Review source changes before motion delivery.')
  const native = materializeOutput(set, output)
  if (!native.timeline) throw new Error('Add motion to this format first.')
  const sources = await fetchDesignSources(client, native)
  const document = mapDesignSources(native, (reference) => sources[reference] ?? reference)
  const size = outputDimensions(output)
  if (size.width % 2 || size.height % 2)
    throw new Error('Video needs even dimensions. Adjust this imported format before exporting.')
  const fps = 24,
    total = Math.ceil((native.timeline.duration / 1000) * fps)
  const audio = await renderAudioMix(document.timeline?.audio ?? [], native.timeline.duration)
  const encoder = new WebCodecsVideoEncoder({
    width: size.width,
    height: size.height,
    fps,
    container: format,
    audio,
  })
  const canvas = new OffscreenCanvas(size.width, size.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Video rendering is unavailable in this browser.')
  try {
    await encoder.initialize()
    for (let frame = 0; frame < total; frame++) {
      signal.throwIfAborted()
      const capture = await renderDocument(
        document,
        { format: 'png', strict: true, scale: 1 },
        { signal, time: (frame / fps) * 1000 }
      )
      if (capture.width !== size.width || capture.height !== size.height)
        throw new Error('Unexpected video frame dimensions.')
      const image = await createImageBitmap(capture.blob)
      try {
        context.drawImage(image, 0, 0)
        await encoder.encodeFromCanvas(canvas, frame)
      } finally {
        image.close()
      }
      onProgress((frame + 1) / total)
    }
    signal.throwIfAborted()
    const blob = await encoder.finalize()
    return {
      blob,
      manifest: {
        id: crypto.randomUUID(),
        revision,
        outputId: output.id,
        fileName: outputFileName(`story-${output.storyId.slice(0, 8)}`, output, revision).replace(
          /\.png$/,
          `.${format}`
        ),
        documentHash: await resolvedDocumentHash(native),
        sources: getDesignAssetIds(native).map((id) => `asset:${id}`),
        brand: set.brand ? { id: set.brand.id, version: set.brand.version } : null,
        composition: output.composition,
      },
    }
  } finally {
    encoder.dispose()
  }
}
