'use client'

import type { DesignDocument } from '@/lib/design/document'
import type { StageOutput } from './capture'
import { renderDocument } from './scene-renderer'

/**
 * Rendered previews, keyed by what they show. Two thumbnails of the same
 * document and output share one render, and a changed document is a new key,
 * so invalidation is automatic: a frame change renders new previews and the
 * old ones age out.
 */

const MAX_PREVIEWS = 120

type Entry = { promise: Promise<string>; url: string | null }
const entries = new Map<string, Entry>()

/** FNV-1a: a short, stable key for a long document string. */
export function hashString(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36) + value.length.toString(36)
}

/** The cache key of a preview. */
export function previewKey(document: DesignDocument, output: StageOutput, time = 0): string {
  return hashString(JSON.stringify([document, output, time]))
}

/** A finished preview's URL, if it is already cached. */
export function cachedPreview(key: string): string | null {
  return entries.get(key)?.url ?? null
}

/**
 * Render (or reuse) a preview and resolve to an object URL. A render whose
 * caller aborted is not cached, so the next request renders again.
 */
export function renderPreview(
  key: string,
  document: DesignDocument,
  output: StageOutput,
  options: { signal?: AbortSignal; time?: number } = {}
): Promise<string> {
  const existing = entries.get(key)
  if (existing) {
    entries.delete(key)
    entries.set(key, existing)
    return existing.promise
  }
  const entry: Entry = { promise: Promise.resolve(''), url: null }
  entry.promise = renderDocument(document, output, options).then(
    ({ blob }) => {
      entry.url = URL.createObjectURL(blob)
      return entry.url
    },
    (error: unknown) => {
      entries.delete(key)
      throw error
    }
  )
  entries.set(key, entry)
  // ponytail: evicts by recency, so a preview still on screen past 120 newer
  // renders is revoked; key-count bound, not byte-size bound.
  while (entries.size > MAX_PREVIEWS) {
    const [oldestKey, oldest] = entries.entries().next().value as [string, Entry]
    entries.delete(oldestKey)
    if (oldest.url) URL.revokeObjectURL(oldest.url)
  }
  return entry.promise
}
