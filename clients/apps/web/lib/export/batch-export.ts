'use client'

import type { DesignDocument } from '@/lib/design/document'
import type { StageOutput } from '@/lib/render/capture'
import { renderDocument } from '@/lib/render/scene-renderer'
import { adaptDocumentToSize } from './adapt'
import type { BatchOutput } from './batch'
import { PDF_JPEG_QUALITY, type StillFormat } from './export-design'
import { formatHasControl, type PdfCompression, type QualityPresetName } from './formats'
import { pdfImageFromBlob, type PdfPage, writePdf } from './pdf'
import type { ExportTarget } from './sizes'

/** How every item of a batch is exported. */
export type BatchOutputSettings = {
  format: StillFormat
  pdfCompression: PdfCompression
  quality: QualityPresetName
  scale: number
  targets: readonly ExportTarget[]
}

/** A decoded screenshot: its pixel size and a small JPEG for thumbnails. */
export type DecodedScreenshot = { height: number; previewBlob: Blob; width: number }

/** The long side of the thumbnail proxy, in px; previews are drawn at most 480px wide. */
const PREVIEW_SIDE = 640

/**
 * Decode an image file off the main thread (`createImageBitmap`), read its
 * size, and make a small JPEG proxy so thumbnails never embed the
 * full-size screenshot. Rejects files that are not readable images.
 */
export async function decodeScreenshot(file: Blob): Promise<DecodedScreenshot> {
  const full = await createImageBitmap(file)
  const { height, width } = full
  try {
    const factor = Math.min(1, PREVIEW_SIDE / Math.max(width, height))
    const small = await createImageBitmap(full, {
      resizeHeight: Math.max(1, Math.round(height * factor)),
      resizeQuality: 'medium',
      resizeWidth: Math.max(1, Math.round(width * factor)),
    })
    try {
      const canvas = document.createElement('canvas')
      canvas.width = small.width
      canvas.height = small.height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('The browser could not prepare a preview.')
      context.drawImage(small, 0, 0)
      const previewBlob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (blob) =>
            blob ? resolve(blob) : reject(new Error('The browser could not prepare a preview.')),
          'image/jpeg',
          0.85
        )
      )
      return { height, previewBlob, width }
    } finally {
      small.close()
    }
  } finally {
    full.close()
  }
}

/**
 * Render one batch item at every target size through the render frame.
 * `onSize` reports each finished size. PDF output is one file with a page
 * per size; every other format is one file per size.
 */
export async function renderBatchItem(
  document: DesignDocument,
  imageAspect: number | undefined,
  settings: BatchOutputSettings,
  { onSize, signal }: { onSize?: (done: number) => void; signal?: AbortSignal } = {}
): Promise<BatchOutput[]> {
  const output: StageOutput = {
    format: settings.format === 'pdf' ? 'png' : settings.format,
    quality: settings.quality,
    // A format without a resolution setting (SVG) is drawn at its size.
    scale: formatHasControl(settings.format, 'scale') ? settings.scale : 1,
  }
  const outputs: BatchOutput[] = []
  const pages: PdfPage[] = []
  for (const [index, target] of settings.targets.entries()) {
    signal?.throwIfAborted()
    const adapted = adaptDocumentToSize(document, target, { imageAspect })
    const { blob } = await renderDocument(adapted, output, { signal })
    if (settings.format === 'pdf') {
      const image = await pdfImageFromBlob(
        blob,
        settings.pdfCompression,
        PDF_JPEG_QUALITY[settings.quality]
      )
      pages.push({ height: target.height, image, width: target.width })
    } else {
      outputs.push({ blob, target })
    }
    onSize?.(index + 1)
  }
  if (settings.format !== 'pdf') return outputs
  return [{ blob: new Blob([writePdf(pages)], { type: 'application/pdf' }) }]
}
