import { z } from 'zod'
import { extensionFor, type OutputFormat } from './formats'
import { CANVAS_TARGET_ID, type ExportTarget } from './sizes'

/**
 * File and folder names for exports. Names are safe on every desktop file
 * system and inside a ZIP, and say what a file is without opening it:
 *
 * - one design, one size: `<name>-<w>x<h>.<ext>`
 * - one design, several sizes (ZIP): `<name>-<size>-<w>x<h>.<ext>`
 * - batch (ZIP): `<size>-<w>x<h>/<NN>-<name>.<ext>`, one folder per size, so
 *   each folder is a complete set for one platform
 * - PDF holds one page per size: `<name>.pdf`, and `<NN>-<name>.pdf` in a batch
 *
 * A scaled export adds `@<n>x` to the size, as design tools do.
 */

/** The fallback base name when a source has none. */
export const DEFAULT_EXPORT_NAME = 'shots'

type SizedTarget = Pick<ExportTarget, 'height' | 'id' | 'width'>

/** A file name without its image or video extension (`shot.final.png` → `shot.final`). */
export function stripExtension(fileName: string): string {
  return fileName.replace(/\.(png|jpe?g|webp|gif|avif|heic|svg|pdf|mp4|webm|mov)$/i, '')
}

/** A safe base name of at most `maxLength` characters: path, reserved, and control characters replaced. */
export function safeBaseName(name: string, fallback = DEFAULT_EXPORT_NAME, maxLength = 60): string {
  const cleaned = stripExtension(name)
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, maxLength)
    .replace(/[-.]+$/g, '')
  return cleaned || fallback
}

/** `<size>-<w>x<h>` (just `<w>x<h>` for the canvas), plus `@<n>x` when scaled. */
export function sizeSlug(target: SizedTarget, scale = 1): string {
  const dimensions = `${Math.round(target.width)}x${Math.round(target.height)}`
  const base = target.id === CANVAS_TARGET_ID ? dimensions : `${target.id}-${dimensions}`
  return scale === 1 ? base : `${base}@${scale}x`
}

/**
 * The name of one exported file of one design. A PDF has one page per size,
 * so its name carries no size.
 */
export function designFileName(
  name: string,
  format: OutputFormat,
  target?: SizedTarget,
  scale = 1
): string {
  const base = safeBaseName(name)
  if (format === 'pdf' || !target) return `${base}.${extensionFor(format)}`
  return `${base}-${sizeSlug(target, scale)}.${extensionFor(format)}`
}

/** `NN`: a 1-based index padded to the batch length, so files sort in import order. */
export function batchIndex(index: number, total: number): string {
  return String(index + 1).padStart(String(Math.max(1, total)).length, '0')
}

/** The path of one batch file inside the ZIP. See the module comment for the layout. */
export function batchEntryPath(parts: {
  format: OutputFormat
  index: number
  name: string
  scale?: number
  target?: SizedTarget
  total: number
}): string {
  const file = `${batchIndex(parts.index, parts.total)}-${safeBaseName(parts.name, `item`)}.${extensionFor(parts.format)}`
  if (parts.format === 'pdf' || !parts.target) return file
  return `${sizeSlug(parts.target, parts.scale)}/${file}`
}

/** What a ZIP holds: one design in several sizes, or a batch. */
export const zipKindSchema = z.enum(['batch', 'sizes'])
/** A ZIP kind. */
export type ZipKind = z.infer<typeof zipKindSchema>

/** The ZIP's own name. */
export function zipFileName(name: string, kind: ZipKind): string {
  return `${safeBaseName(name)}-${kind}.zip`
}
