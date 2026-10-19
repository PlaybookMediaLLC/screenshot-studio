import { getLocalDesignSources, mapDesignSources } from '@/lib/design/document'
import { creativeSetDocumentSchema, type CreativeSetDocument } from './document'

export type SetRecovery = {
  key: string
  workspaceId: string
  setId: string
  tabId: string
  revision: number
  updatedAt: number
  document: CreativeSetDocument
  blobs?: Record<string, Blob>
}

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('platform-story-set-recovery', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: 'key' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/** Each tab keeps its own draft; neither another set nor the legacy editor can overwrite it. */
export async function writeSetRecovery(record: SetRecovery): Promise<void> {
  const document = structuredClone(record.document)
  const blobs: Record<string, Blob> = {}
  for (const output of document.outputs) {
    for (const ref of getLocalDesignSources(output.document)) {
      if (ref.startsWith('blob:') && !blobs[ref]) blobs[ref] = await (await fetch(ref)).blob()
    }
  }
  const db = await database()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('drafts', 'readwrite')
      tx.objectStore('drafts').put({ ...record, document, blobs })
      tx.oncomplete = () => resolve()
      tx.onabort = tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

export async function readSetRecoveries(
  workspaceId: string,
  setId: string
): Promise<SetRecovery[]> {
  const db = await database()
  try {
    const records = await new Promise<SetRecovery[]>((resolve, reject) => {
      const request = db.transaction('drafts').objectStore('drafts').getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    return records
      .filter((record) => record.workspaceId === workspaceId && record.setId === setId)
      .map((record) => {
        const document = creativeSetDocumentSchema.parse(record.document)
        const sources = Object.fromEntries(
          Object.entries(record.blobs ?? {}).map(([ref, blob]) => [ref, URL.createObjectURL(blob)])
        )
        for (const output of document.outputs)
          output.document = mapDesignSources(output.document, (ref) => sources[ref] ?? ref)
        return { ...record, document }
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
  } finally {
    db.close()
  }
}

export async function removeSetRecovery(key: string): Promise<void> {
  const db = await database()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('drafts', 'readwrite')
      tx.objectStore('drafts').delete(key)
      tx.oncomplete = () => resolve()
      tx.onabort = tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}
