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

type Entry = { promise: Promise<string>; url: string | null; readers: Set<AbortSignal> }
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
 * Render (or reuse) a preview and resolve to a durable data URL. Shared work outlives
 * individual subscribers, so unmounting one card cannot cancel another's render.
 */
export function renderPreview(
  key: string,
  document: DesignDocument,
  output: StageOutput,
  options: { time?: number; signal: AbortSignal }
): Promise<string> {
  const subscribe = (entry: Entry) => {
    entry.readers.add(options.signal)
    const release = () => entry.readers.delete(options.signal)
    options.signal.addEventListener('abort', release, { once: true })
    void entry.promise.finally(() => { release(); options.signal.removeEventListener('abort', release) }).catch(() => {})
    return entry.promise
  }
  const existing = entries.get(key)
  if (existing) {
    entries.delete(key)
    entries.set(key, existing)
    return subscribe(existing)
  }
  const entry: Entry = { promise: Promise.resolve(''), url: null, readers: new Set() }
  entry.promise = renderDocument(document, output, { time: options.time, shouldSkip: () => entry.readers.size === 0 }).then(
    async ({ blob }) => {
      entry.url = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(blob)
      })
      return entry.url
    }
  ).catch((error: unknown) => {
      if (entries.get(key) === entry) entries.delete(key)
      throw error
    })
  entries.set(key, entry)
  // Mounted cards own their data URL even after the cache drops its reference.
  while (entries.size > MAX_PREVIEWS) {
    const oldestKey = entries.keys().next().value!
    entries.delete(oldestKey)
  }
  return subscribe(entry)
}
