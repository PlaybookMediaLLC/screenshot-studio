import { z } from 'zod'
import type { TRPCClient } from '@trpc/client'
import type { AppRouter } from '@/lib/trpc/router'
import { getDesignAssetIds, mapDesignSources, type DesignDocument } from '@/lib/design/document'
import { fetchDesignSources } from '@/lib/design/open-design'
import { resolvedDocumentHash } from '@/lib/creative-sets/delivery'
import { withoutBackground } from '@/lib/export/adapt'
import { renderDocument } from '@/lib/render/scene-renderer'
import { pdfImageFromBlob, writePdf } from '@/lib/export/pdf'
import { zipFiles } from '@/lib/export/zip'
import { artboardRect, artboardSize, type Artboard, type CanvasDocument } from './document'
import { readingOrder } from './layout'

/**
 * Artboard export through the editor's one renderer. Each artboard renders
 * from its saved native document at its exact export size in strict mode, so
 * a missing image or font, or copy that overflows its box, stops the export
 * with a message instead of producing a blank or degraded file.
 */

/** File formats a canvas exports. PDF pages are images, one per artboard. */
export const canvasExportFormatSchema = z.enum(['png', 'jpeg', 'webp', 'pdf'])
/** One of {@link canvasExportFormatSchema}. */
export type CanvasExportFormat = z.infer<typeof canvasExportFormatSchema>

/** The order files and PDF pages follow. */
export const canvasExportOrderSchema = z.enum(['reading', 'layers'])
/** One of {@link canvasExportOrderSchema}. */
export type CanvasExportOrder = z.infer<typeof canvasExportOrderSchema>

/** Export settings. */
export const canvasExportOptionsSchema = z.object({
  format: canvasExportFormatSchema.default('png'),
  scale: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
  order: canvasExportOrderSchema.default('reading'),
  /** Transparent background (PNG and WebP only). */
  transparent: z.boolean().default(false),
  /** Show hidden layers in the files. Off unless asked for. */
  includeHidden: z.boolean().default(false),
})
/** One of {@link canvasExportOptionsSchema}. */
export type CanvasExportOptions = z.input<typeof canvasExportOptionsSchema>

/** What a delivered file was made from; also the campaign handoff record. */
export type ArtboardManifest = {
  id: string
  revision: number
  outputId: string
  fileName: string
  documentHash: string
  sources: string[]
  brand: { id: string; version: number } | null
  composition: { id: string; version: number }
}

/** One rendered artboard. */
export type RenderedArtboard = {
  blob: Blob
  width: number
  height: number
  manifest: ArtboardManifest
}

const slug = (value: string, fallback: string) =>
  value
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 60) || fallback

const EXTENSIONS: Record<CanvasExportFormat, string> = {
  png: 'png',
  jpeg: 'jpg',
  webp: 'webp',
  pdf: 'png',
}

/** The file name of a canvas PDF at a revision. */
export function canvasPdfFileName(canvasName: string, revision: number) {
  return `${slug(canvasName, 'canvas')}-r${revision}.pdf`
}

/** `<canvas>-<nn>-<artboard>-<w>x<h>-r<revision>.<ext>`: sortable and unique within one export. */
export function artboardFileName(
  canvasName: string,
  artboard: Pick<Artboard, 'id' | 'name' | 'document'>,
  index: number,
  revision: number,
  format: CanvasExportFormat,
  scale = 1
): string {
  const size = artboardSize(artboard)
  return `${slug(canvasName, 'canvas')}-${String(index + 1).padStart(2, '0')}-${slug(artboard.name, artboard.id.slice(0, 8))}-${size.width * scale}x${size.height * scale}-r${revision}.${EXTENSIONS[format]}`
}

/** The artboards an export covers, in the order it writes them. */
export function exportSelection(
  canvas: CanvasDocument,
  ids: readonly string[],
  order: CanvasExportOrder = 'reading'
): Artboard[] {
  const chosen = canvas.artboards.filter((artboard) => ids.includes(artboard.id))
  if (order === 'layers') return chosen
  return readingOrder(
    chosen.map((artboard) => ({ id: artboard.id, rect: artboardRect(artboard), artboard }))
  ).map((item) => item.artboard)
}

/** The native document as it should render: hidden layers revealed only on request, background dropped for transparency. */
export function documentForExport(
  document: DesignDocument,
  { includeHidden = false, transparent = false }: { includeHidden?: boolean; transparent?: boolean }
): DesignDocument {
  let next = document
  if (includeHidden) {
    next = structuredClone(next)
    for (const layers of [next.texts, next.overlays, next.annotations, next.redactions])
      for (const layer of layers) layer.visible = true
    for (const element of next.elements) element.visible = true
    for (const mockup of next.devices?.mockups ?? []) mockup.visible = true
  }
  return transparent ? withoutBackground(next) : next
}

/** Render one artboard exactly; a size mismatch is an error, never a stretched file. */
export async function renderArtboard(
  client: TRPCClient<AppRouter>,
  artboard: Artboard,
  context: {
    canvasName: string
    revision: number
    index: number
    composition?: { id: string; version: number }
  },
  raw: CanvasExportOptions = {},
  signal?: AbortSignal
): Promise<RenderedArtboard> {
  const options = canvasExportOptionsSchema.parse(raw)
  const native = documentForExport(artboard.document, {
    includeHidden: options.includeHidden,
    transparent: options.transparent && (options.format === 'png' || options.format === 'webp'),
  })
  const sources = await fetchDesignSources(client, native)
  signal?.throwIfAborted()
  const missing = getDesignAssetIds(native).filter((id) => !sources[`asset:${id}`])
  if (missing.length)
    throw new Error(
      `“${artboard.name}” uses an image that is no longer available. Replace it before exporting.`
    )
  const document = mapDesignSources(native, (ref) => sources[ref] ?? ref)
  const format = options.format === 'pdf' ? 'png' : options.format
  const capture = await renderDocument(
    document,
    { format, strict: true, scale: options.scale },
    { signal }
  )
  const size = artboardSize(artboard)
  if (
    capture.width !== size.width * options.scale ||
    capture.height !== size.height * options.scale
  )
    throw new Error(`“${artboard.name}” rendered at an unexpected size.`)
  return {
    ...capture,
    manifest: {
      id: crypto.randomUUID(),
      revision: context.revision,
      outputId: artboard.id,
      fileName: artboardFileName(
        context.canvasName,
        artboard,
        context.index,
        context.revision,
        options.format,
        options.scale
      ),
      documentHash: await resolvedDocumentHash(artboard.document),
      sources: getDesignAssetIds(artboard.document).map((id) => `asset:${id}`),
      brand:
        artboard.document.brand?.kitId && artboard.document.brand.version
          ? { id: artboard.document.brand.kitId, version: artboard.document.brand.version }
          : null,
      composition:
        context.composition ??
        (artboard.origin?.kind === 'recipe'
          ? { id: artboard.origin.id, version: artboard.origin.version }
          : { id: 'canvas-artboard', version: 1 }),
    },
  }
}

/**
 * The files to download: one file as it is, several as a ZIP with a
 * manifest, or every page in one PDF.
 */
export async function packageArtboards(
  rendered: readonly RenderedArtboard[],
  {
    format,
    canvasName,
    canvasId,
    revision,
  }: { format: CanvasExportFormat; canvasName: string; canvasId: string; revision: number }
): Promise<{ blob: Blob; fileName: string }> {
  if (!rendered.length) throw new Error('Choose at least one artboard to export.')
  if (format === 'pdf') {
    const pages = []
    for (const item of rendered)
      pages.push({
        width: item.width,
        height: item.height,
        image: await pdfImageFromBlob(item.blob, 'jpeg', 0.92),
      })
    const bytes = writePdf(pages, { title: canvasName })
    return {
      blob: new Blob([bytes.slice().buffer], { type: 'application/pdf' }),
      fileName: canvasPdfFileName(canvasName, revision),
    }
  }
  if (rendered.length === 1)
    return { blob: rendered[0]!.blob, fileName: rendered[0]!.manifest.fileName }
  const manifest = new TextEncoder().encode(
    JSON.stringify(
      { canvasId, revision, artboards: rendered.map((item) => item.manifest) },
      null,
      2
    )
  )
  return {
    blob: await zipFiles([
      ...rendered.map((item) => ({ path: item.manifest.fileName, data: item.blob })),
      { path: 'manifest.json', data: manifest },
    ]),
    fileName: `${slug(canvasName, 'canvas')}-r${revision}.zip`,
  }
}
