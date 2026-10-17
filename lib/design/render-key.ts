import { createHash } from 'node:crypto'
import type { DesignDocument } from './document'

/**
 * Cache key for one rendered image of a design.
 *
 * Two renders with the same key produce the same pixels: same document, same
 * output format and scale, and the same bytes behind every referenced image.
 * Each `asset:<id>` is hashed as its content fingerprint rather than its id,
 * so a recapture that stores the same bytes under a new asset id still hits
 * the cache. Object keys are sorted so equivalent documents hash the same
 * regardless of how their JSON was built.
 */

export const RENDER_KEY_VERSION = 2

function canonical(value: unknown, assets: Record<string, string>): unknown {
  if (typeof value === 'string' && value.startsWith('asset:')) {
    const fingerprint = assets[value.slice('asset:'.length)]
    return fingerprint ? `asset:${fingerprint}` : value
  }
  if (Array.isArray(value)) return value.map((entry) => canonical(entry, assets))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => [key, canonical(entry, assets)])
    )
  }
  return value
}

export function designRenderKey(input: {
  /**
   * Content fingerprint per referenced asset id: its SHA-256, or a stand-in
   * that includes the id, since only a content hash may be shared by two ids.
   */
  assets: Record<string, string>
  document: DesignDocument
  options: { format: string; scale: number }
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify(
        canonical(
          { document: input.document, options: input.options, version: RENDER_KEY_VERSION },
          input.assets
        )
      )
    )
    .digest('hex')
}
