import { readStoreDocument } from '../document/migrate'
import type { StoreDocument } from '../document/schema'
import { ingestPendingAssets } from './ingest'
import { getMeta, saveProject, setMeta } from './projects'

/**
 * One-time import of the version 1 working session.
 *
 * Version 1 kept a single project in the `screenshotstudio-store-projects`
 * database. It is converted, its images moved to the asset store, and saved
 * as a library project. The old record is removed only after the new
 * project is safely saved.
 */

const LEGACY_DB = 'screenshotstudio-store-projects'
const LEGACY_STORE = 'projects'
const LEGACY_KEY = 'active-store-project'
const MIGRATED_FLAG = 'legacyImported'

function openLegacy(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    const request = indexedDB.open(LEGACY_DB)
    request.onupgradeneeded = () => {
      // The database did not exist; creating it empty is harmless.
      if (!request.result.objectStoreNames.contains(LEGACY_STORE)) request.result.createObjectStore(LEGACY_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
  })
}

function legacyRequest<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(LEGACY_STORE, mode)
    const request = run(transaction.objectStore(LEGACY_STORE))
    transaction.oncomplete = () => resolve(request.result)
    transaction.onerror = () => reject(transaction.error)
  })
}

/** Import the version 1 project if there is one. Returns the imported document. */
export async function importLegacyProject(): Promise<StoreDocument | null> {
  if (await getMeta<boolean>(MIGRATED_FLAG)) return null
  const db = await openLegacy()
  if (!db) return null
  try {
    const stored = await legacyRequest(db, 'readonly', (store) => store.get(LEGACY_KEY))
    if (!stored) {
      await setMeta(MIGRATED_FLAG, true)
      return null
    }
    const result = readStoreDocument(stored)
    const document = await ingestPendingAssets(result)
    const saved = await saveProject(document, 0, null)
    await legacyRequest(db, 'readwrite', (store) => store.delete(LEGACY_KEY))
    await setMeta(MIGRATED_FLAG, true)
    return saved
  } finally {
    db.close()
  }
}
