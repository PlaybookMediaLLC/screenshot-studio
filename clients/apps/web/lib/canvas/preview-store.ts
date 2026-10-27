'use client'

import { hashString } from '@/lib/render/preview-cache'
import type { DesignDocument } from '@/lib/design/document'

/**
 * Artboard previews kept on this device between visits. A preview is keyed
 * by the stored document's content and the rendered width, so an edited
 * artboard never shows an old image. Previews hold the same content the
 * recovery drafts already keep locally.
 */

const DATABASE = 'platform-canvas-previews'
const STORE = 'previews'
/** Bump when the renderer's output changes, so older images are not reused. */
const RENDER_VERSION = 1
/** Most previews kept; the oldest are dropped first. */
const LIMIT = 300

type Record = { key: string; blob: Blob; at: number }

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: 'key' }).createIndex('at', 'at')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/** The key of a stored document rendered at a width. */
export function storedPreviewKey(document: DesignDocument, width: number): string {
  const json = JSON.stringify(document)
  return `v${RENDER_VERSION}:${width}:${json.length}:${hashString(json)}`
}

/** A kept preview, or null. Storage failures read as a miss. */
export async function readStoredPreview(key: string): Promise<Blob | null> {
  try {
    const db = await open()
    try {
      return await new Promise<Blob | null>((resolve, reject) => {
        const request = db.transaction(STORE).objectStore(STORE).get(key)
        request.onsuccess = () => resolve((request.result as Record | undefined)?.blob ?? null)
        request.onerror = () => reject(request.error)
      })
    } finally {
      db.close()
    }
  } catch {
    return null
  }
}

/** Keep a preview, dropping the oldest beyond the limit. Failures are ignored. */
export async function writeStoredPreview(key: string, blob: Blob): Promise<void> {
  try {
    const db = await open()
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite')
        const store = tx.objectStore(STORE)
        store.put({ key, blob, at: Date.now() } satisfies Record)
        const count = store.count()
        count.onsuccess = () => {
          let excess = count.result - LIMIT
          if (excess <= 0) return
          const oldest = store.index('at').openCursor()
          oldest.onsuccess = () => {
            const cursor = oldest.result
            if (!cursor || excess-- <= 0) return
            cursor.delete()
            cursor.continue()
          }
        }
        tx.oncomplete = () => resolve()
        tx.onabort = tx.onerror = () => reject(tx.error)
      })
    } finally {
      db.close()
    }
  } catch {
    /* A preview is a convenience; it renders again next time. */
  }
}
