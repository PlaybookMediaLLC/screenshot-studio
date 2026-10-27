import { z } from 'zod'
import { GRID_COLUMNS, GRID_ROWS, toHex } from '../engine/color'

/**
 * Screenshot validation and analysis.
 *
 * Files are identified by their bytes, not their name or reported MIME
 * type. Only raster formats are accepted: SVG can carry script and external
 * references, so it is refused outright. Decoding happens in the browser's
 * image decoder, and oversized dimensions are refused before any canvas is
 * allocated.
 */

/** Raster formats accepted for screenshots and backgrounds. */
export const rasterFormatSchema = z.enum(['png', 'jpeg', 'webp'])

/** Raster format. */
export type RasterFormat = z.infer<typeof rasterFormatSchema>

/** Largest accepted file. */
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024

/** Largest accepted side, to refuse decompression bombs. */
export const MAX_IMAGE_SIDE = 8192

/** MIME type for each accepted format. */
export const RASTER_MIME: Record<RasterFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}

/** Identify a raster image by its signature. Null for anything else, including SVG. */
export function sniffRasterFormat(bytes: Uint8Array): RasterFormat | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'png'
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'
  if (
    bytes.length >= 12 &&
    String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === 'RIFF' &&
    String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]) === 'WEBP'
  ) {
    return 'webp'
  }
  return null
}

/** A user-facing image problem. */
export class ImageValidationError extends Error {
  /** Create an error naming the file and the problem. */
  constructor(message: string) {
    super(message)
    this.name = 'ImageValidationError'
  }
}

/** Measurements the editor keeps for an image. */
export type ImageAnalysis = {
  width: number
  height: number
  /** Row-major GRID_COLUMNS x GRID_ROWS average colors, for contrast checks. */
  colorGrid: string[]
  /** Average color of the top 4%, used under a drawn status bar. */
  topColor: string
}

/** Lowercase hex SHA-256 of bytes. */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function averageColors(
  bitmap: ImageBitmap,
  columns: number,
  rows: number,
  source?: { x: number; y: number; width: number; height: number }
): string[] {
  const canvas = new OffscreenCanvas(columns, rows)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return []
  context.imageSmoothingQuality = 'high'
  const area = source ?? { x: 0, y: 0, width: bitmap.width, height: bitmap.height }
  context.drawImage(bitmap, area.x, area.y, area.width, area.height, 0, 0, columns, rows)
  const { data } = context.getImageData(0, 0, columns, rows)
  const colors: string[] = []
  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3] / 255
    colors.push(
      toHex({
        r: data[index] * alpha + 255 * (1 - alpha),
        g: data[index + 1] * alpha + 255 * (1 - alpha),
        b: data[index + 2] * alpha + 255 * (1 - alpha),
      })
    )
  }
  return colors
}

/** Decode and measure an image. Rejects files the browser cannot decode. */
export async function analyzeImage(blob: Blob, name: string): Promise<ImageAnalysis> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(blob)
  } catch {
    throw new ImageValidationError(`“${name}” could not be read as an image.`)
  }
  try {
    if (bitmap.width > MAX_IMAGE_SIDE || bitmap.height > MAX_IMAGE_SIDE) {
      throw new ImageValidationError(
        `“${name}” is ${bitmap.width} × ${bitmap.height}. Images can be at most ${MAX_IMAGE_SIDE} px on a side.`
      )
    }
    const top = Math.max(1, Math.round(bitmap.height * 0.04))
    return {
      width: bitmap.width,
      height: bitmap.height,
      colorGrid: averageColors(bitmap, GRID_COLUMNS, GRID_ROWS),
      topColor: averageColors(bitmap, 1, 1, { x: 0, y: 0, width: bitmap.width, height: top })[0] ?? '#FFFFFF',
    }
  } finally {
    bitmap.close()
  }
}

/** Validate a file's size and signature. Returns its bytes and format. */
export async function readRasterFile(file: Blob & { name?: string }): Promise<{ bytes: ArrayBuffer; format: RasterFormat }> {
  const name = file.name ?? 'Image'
  if (file.size > MAX_IMAGE_BYTES) {
    throw new ImageValidationError(`“${name}” is larger than 25 MB.`)
  }
  const bytes = await file.arrayBuffer()
  const format = sniffRasterFormat(new Uint8Array(bytes, 0, Math.min(16, bytes.byteLength)))
  if (!format) {
    throw new ImageValidationError(`“${name}” is not a PNG, JPEG, or WebP image.`)
  }
  return { bytes, format }
}
