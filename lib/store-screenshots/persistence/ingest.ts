import { createAssetMeta } from '../document/factory'
import type { MigrationResult } from '../document/migrate'
import type { StoreAsset, StoreDocument } from '../document/schema'
import {
  analyzeImage,
  ImageValidationError,
  RASTER_MIME,
  readRasterFile,
  sha256Hex,
} from '../media/image'
import { putAsset } from './projects'

/**
 * Bringing images into the asset store: validated uploads, and the inline
 * data URLs of migrated version 1 projects.
 */

/** Asset id derived from content, so the same image imported twice is stored once. */
export function contentAssetId(sha256: string): string {
  return `img_${sha256.slice(0, 32)}`
}

/** Validate, measure, and store an uploaded image. */
export async function ingestImageFile(file: File): Promise<StoreAsset> {
  const { bytes, format } = await readRasterFile(file)
  const blob = new Blob([bytes], { type: RASTER_MIME[format] })
  const analysis = await analyzeImage(blob, file.name)
  const id = contentAssetId(await sha256Hex(bytes))
  await putAsset(id, blob)
  return createAssetMeta({
    id,
    name: file.name.slice(0, 200) || 'Image',
    mime: blob.type,
    width: analysis.width,
    height: analysis.height,
    bytes: blob.size,
    colorGrid: analysis.colorGrid,
    topColor: analysis.topColor,
  })
}

/** Result of importing several files. Failures do not stop the rest. */
export type IngestReport = { assets: StoreAsset[]; failures: Array<{ name: string; reason: string }> }

/**
 * Import files in order with bounded work per step. `onProgress` reports
 * completed files; `signal` stops between files.
 */
export async function ingestImageFiles(
  files: File[],
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal
): Promise<IngestReport> {
  const report: IngestReport = { assets: [], failures: [] }
  for (const [index, file] of files.entries()) {
    if (signal?.aborted) break
    try {
      report.assets.push(await ingestImageFile(file))
    } catch (cause) {
      report.failures.push({
        name: file.name,
        reason: cause instanceof ImageValidationError ? cause.message : 'The image could not be imported.',
      })
    }
    onProgress?.(index + 1, files.length)
  }
  return report
}

async function blobFromSource(src: string): Promise<Blob> {
  const response = await fetch(src)
  if (!response.ok) throw new Error(`Image request failed with ${response.status}`)
  return response.blob()
}

/**
 * Copy a migrated document's inline images into the asset store and record
 * their real measurements. Remote images (the background library) keep their
 * URL; only their measurements are added when the browser can read them.
 */
export async function ingestPendingAssets(result: MigrationResult): Promise<StoreDocument> {
  if (result.pendingAssets.length === 0) return result.document
  const assets = { ...result.document.assets }
  for (const pending of result.pendingAssets) {
    const meta = assets[pending.assetId]
    if (!meta) continue
    try {
      const blob = await blobFromSource(pending.src)
      const analysis = await analyzeImage(blob, pending.name)
      if (pending.src.startsWith('data:')) await putAsset(pending.assetId, blob)
      assets[pending.assetId] = {
        ...meta,
        mime: blob.type || meta.mime,
        width: analysis.width,
        height: analysis.height,
        bytes: blob.size,
        colorGrid: analysis.colorGrid,
        topColor: analysis.topColor,
      }
    } catch {
      // Keep the placeholder measurements; the image still renders from its source.
    }
  }
  return { ...result.document, assets }
}
