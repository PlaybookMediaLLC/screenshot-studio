'use client'

import { z } from 'zod'
import type { DesignDocument } from '@/lib/design/document'
import { exportDesignDocument } from '@/lib/design/export'
import { captureStage, type StageOutput } from '@/lib/render/capture'
import { renderDocument } from '@/lib/render/scene-renderer'
import { adaptDocumentToSize, withoutBackground } from './adapt'
import { type PdfCompression, type QualityPresetName } from './formats'
import { batchIndex, designFileName, safeBaseName, zipFileName } from './naming'
import { pdfImageFromBlob, type PdfPage, writePdf } from './pdf'
import { CANVAS_TARGET_ID, type ExportTarget } from './sizes'
import { zipFiles } from './zip'

/**
 * Still exports of the design being edited: every format except the
 * animated ones, at one or several target sizes.
 *
 * Every file comes from the editor's one stage. The canvas size is captured
 * from the live stage, exactly as shown; any other size, and a transparent
 * export, is the same design laid out again for that size
 * (`adaptDocumentToSize`) and drawn by the render frame (`renderDocument`),
 * which runs the same stage without touching the design being edited.
 */

/** Formats exported as stills. */
export const stillFormatSchema = z.enum(['png', 'jpeg', 'webp', 'svg', 'pdf'])
/** A still format. */
export type StillFormat = z.infer<typeof stillFormatSchema>

/** JPEG quality inside PDF pages, by preset (0-1). */
export const PDF_JPEG_QUALITY: Record<QualityPresetName, number> = {
  high: 0.92,
  low: 0.7,
  medium: 0.82,
}

/** What to export. */
export type StillExportRequest = {
  format: StillFormat
  /** Base file name, usually the screenshot's name. */
  name: string
  pdfCompression: PdfCompression
  quality: QualityPresetName
  scale: number
  /** Leave the background out (formats with transparency only). */
  transparent: boolean
  /** One file (or PDF page) per slide, when the design has several. */
  allSlides: boolean
  /** Target sizes, in output order; must not be empty. */
  targets: readonly ExportTarget[]
  onProgress?: (done: number, total: number) => void
  signal?: AbortSignal
}

/** One produced file. */
export type ExportedFile = { blob: Blob; name: string }

/** Natural width / height of an image URL, or undefined when it cannot be read. */
export async function imageAspectOf(src: string | null | undefined): Promise<number | undefined> {
  if (!src) return undefined
  const image = new Image()
  image.src = src
  try {
    await image.decode()
    return image.naturalHeight > 0 ? image.naturalWidth / image.naturalHeight : undefined
  } catch {
    return undefined
  }
}

/** One design to export: the design itself, or the design showing one of its slides. */
type Variant = { document: DesignDocument; name: string }

/** The design once per slide when `allSlides` and it has several, else just the design. */
export function slideVariants(
  document: DesignDocument,
  name: string,
  allSlides: boolean
): Variant[] {
  const items = document.slides?.items ?? []
  if (!allSlides || !document.slides || items.length < 2) return [{ document, name }]
  const slides = document.slides
  return items.map((slide, index) => ({
    document: {
      ...document,
      image: { ...document.image, name: slide.name ?? undefined, src: slide.src },
      slides: { ...slides, activeId: slide.id },
    },
    name: `${batchIndex(index, items.length)}-${safeBaseName(slide.name ?? name)}`,
  }))
}

/** Render every target of a request and encode its format: one file per size (and slide), or one PDF. */
export async function exportStill(request: StillExportRequest): Promise<ExportedFile[]> {
  if (request.targets.length === 0) throw new Error('Pick at least one size to export.')
  const variants = slideVariants(
    exportDesignDocument({ keepLocalSources: true }),
    request.name,
    request.allSlides
  )
  // PDF pages are built from a lossless capture, then encoded per the compression setting.
  const output: StageOutput = {
    format: request.format === 'pdf' ? 'png' : request.format,
    quality: request.quality,
    scale: request.scale,
  }
  const total = variants.length * request.targets.length
  const files: ExportedFile[] = []
  const pages: PdfPage[] = []
  let done = 0
  for (const variant of variants) {
    const imageAspect = await imageAspectOf(variant.document.image.src)
    for (const target of request.targets) {
      request.signal?.throwIfAborted()
      // The live stage shows the canvas size of the design as it is; everything else is re-laid out.
      const live = variants.length === 1 && target.id === CANVAS_TARGET_ID && !request.transparent
      const capture = live
        ? await captureStage({ ...output, compress: request.format !== 'pdf' })
        : await renderDocument(
            adaptDocumentToSize(
              request.transparent ? withoutBackground(variant.document) : variant.document,
              target,
              { imageAspect }
            ),
            output,
            { signal: request.signal }
          )
      if (request.format === 'pdf') {
        const image = await pdfImageFromBlob(
          capture.blob,
          request.pdfCompression,
          PDF_JPEG_QUALITY[request.quality]
        )
        pages.push({ height: target.height, image, width: target.width })
      } else {
        files.push({
          blob: capture.blob,
          name: designFileName(variant.name, request.format, target, request.scale),
        })
      }
      request.onProgress?.(++done, total)
    }
  }
  if (request.format !== 'pdf') return files
  const pdf = writePdf(pages, { title: request.name })
  return [
    {
      blob: new Blob([pdf], { type: 'application/pdf' }),
      name: designFileName(request.name, 'pdf'),
    },
  ]
}

/** Save a file through the browser's download. */
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  // The download has started once click returns; give it a moment before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Download exported files: one file as it is, several as one ZIP. Returns the downloaded name. */
export async function deliverFiles(files: readonly ExportedFile[], name: string): Promise<string> {
  if (files.length === 1) {
    downloadBlob(files[0]!.blob, files[0]!.name)
    return files[0]!.name
  }
  const archive = zipFileName(name, 'sizes')
  downloadBlob(await zipFiles(files.map((file) => ({ data: file.blob, path: file.name }))), archive)
  return archive
}
