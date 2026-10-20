import { getLocalDesignSources, mapDesignSources, type DesignDocument } from '@/lib/design/document'
import { creativeSetDocumentSchema, type CreativeSetDocument } from './document'

/** A draft one tab kept on this device, with the local images it needs. */
export type DocumentRecovery<D> = {
  key: string
  workspaceId: string
  setId: string
  tabId: string
  revision: number
  updatedAt: number
  document: D
  blobs?: Record<string, Blob>
}
export type SetRecovery = DocumentRecovery<CreativeSetDocument>

/** How a recovered document is read and where its native documents are. */
export type RecoveryKind<D> = {
  parse: (raw: unknown) => D
  natives: (document: D) => DesignDocument[]
  mapNatives: (document: D, map: (native: DesignDocument) => DesignDocument) => D
}

const storySetRecovery: RecoveryKind<CreativeSetDocument> = {
  parse: (raw) => creativeSetDocumentSchema.parse(raw),
  natives: (document) => document.outputs.map((output) => output.document),
  mapNatives: (document, map) => {
    for (const output of document.outputs) output.document = map(output.document)
    return document
  },
}

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('platform-story-set-recovery', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: 'key' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/** Each tab keeps its own draft; neither another document nor the legacy editor can overwrite it. */
export async function writeRecovery<D>(
  record: DocumentRecovery<D>,
  kind: RecoveryKind<D>
): Promise<void> {
  const document = structuredClone(record.document)
  const blobs: Record<string, Blob> = {}
  for (const native of kind.natives(document)) {
    for (const ref of getLocalDesignSources(native)) {
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

/** This device's drafts of one document, newest first, with local images restored. */
export async function readRecoveries<D>(
  workspaceId: string,
  setId: string,
  kind: RecoveryKind<D>
): Promise<DocumentRecovery<D>[]> {
  const db = await database()
  try {
    const records = await new Promise<DocumentRecovery<unknown>[]>((resolve, reject) => {
      const request = db.transaction('drafts').objectStore('drafts').getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    return records
      .filter((record) => record.workspaceId === workspaceId && record.setId === setId)
      .map((record) => {
        const sources = Object.fromEntries(
          Object.entries(record.blobs ?? {}).map(([ref, blob]) => [ref, URL.createObjectURL(blob)])
        )
        const document = kind.mapNatives(kind.parse(record.document), (native) =>
          mapDesignSources(native, (ref) => sources[ref] ?? ref)
        )
        return { ...record, document }
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
  } finally {
    db.close()
  }
}

export async function writeSetRecovery(record: SetRecovery): Promise<void> {
  return writeRecovery(record, storySetRecovery)
}

export async function readSetRecoveries(
  workspaceId: string,
  setId: string
): Promise<SetRecovery[]> {
  return readRecoveries(workspaceId, setId, storySetRecovery)
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
