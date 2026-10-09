import { createHash } from 'node:crypto'
import type { DesignDocument } from './document'

/**
 * Cache key for one rendered image of a design.
 *
 * Two renders with the same key produce the same pixels: same document, same
 * output format and scale, and the same bytes behind every referenced image
 * (an asset id alone is not enough, since its content is what renders). Object
 * keys are sorted so equivalent documents hash the same regardless of how
 * their JSON was built.
 */

export const RENDER_KEY_VERSION = 1

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => [key, canonical(entry)])
    )
  }
  return value
}

export function designRenderKey(input: {
  /** Content fingerprint per referenced asset id (its SHA-256, or a stand-in). */
  assets: Record<string, string>
  document: DesignDocument
  options: { format: string; scale: number }
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify(
        canonical({
          assets: input.assets,
          document: input.document,
          options: input.options,
          version: RENDER_KEY_VERSION,
        })
      )
    )
    .digest('hex')
}
