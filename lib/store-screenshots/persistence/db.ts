/**
 * The browser database for store screenshot projects.
 *
 * Documents, image bytes, named versions, brand kits, and saved templates
 * live in separate object stores. A document references images by asset id,
 * so autosave writes a few kilobytes of JSON and versions share image bytes
 * instead of copying them.
 */

/** Database name. */
export const STORE_DB_NAME = 'shots-store-studio'

/** Schema version of the database (not of documents). */
export const STORE_DB_VERSION = 1

/** Object stores. */
export const STORES = {
  projects: 'projects',
  assets: 'assets',
  versions: 'versions',
  brandKits: 'brandKits',
  templates: 'templates',
  meta: 'meta',
} as const

/** An object store name. */
export type StoreName = (typeof STORES)[keyof typeof STORES]

let opening: Promise<IDBDatabase> | null = null

/** Open (and create or upgrade) the database. The connection is shared. */
export function openStoreDb(): Promise<IDBDatabase> {
  if (opening) return opening
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(STORE_DB_NAME, STORE_DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORES.projects)) db.createObjectStore(STORES.projects, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(STORES.assets)) db.createObjectStore(STORES.assets, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(STORES.versions)) {
        db.createObjectStore(STORES.versions, { keyPath: 'id' }).createIndex('byProject', 'projectId')
      }
      if (!db.objectStoreNames.contains(STORES.brandKits)) db.createObjectStore(STORES.brandKits, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(STORES.templates)) db.createObjectStore(STORES.templates, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(STORES.meta)) db.createObjectStore(STORES.meta)
    }
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => {
        db.close()
        opening = null
      }
      resolve(db)
    }
    request.onerror = () => {
      opening = null
      reject(request.error ?? new Error('Could not open the project database.'))
    }
    request.onblocked = () => {
      opening = null
      reject(new Error('Close other Shots tabs to finish updating the project database.'))
    }
  })
  return opening
}

/** Promise for an IDB request. */
export function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/** Run work in one transaction and resolve when it commits. */
export async function transact<T>(
  names: StoreName[],
  mode: IDBTransactionMode,
  work: (transaction: IDBTransaction) => Promise<T> | T
): Promise<T> {
  const db = await openStoreDb()
  const transaction = db.transaction(names, mode)
  const done = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error ?? new Error('The save was cancelled.'))
  })
  let result: T
  try {
    result = await work(transaction)
  } catch (error) {
    try {
      transaction.abort()
    } catch {
      // Already finished; the original error is what matters.
    }
    await done.catch(() => undefined)
    throw error
  }
  await done
  return result
}

/** Read one record. */
export async function getRecord<T>(name: StoreName, key: IDBValidKey): Promise<T | undefined> {
  return transact([name], 'readonly', (transaction) =>
    requestResult(transaction.objectStore(name).get(key) as IDBRequest<T | undefined>)
  )
}

/** Read every record in a store. */
export async function getAllRecords<T>(name: StoreName): Promise<T[]> {
  return transact([name], 'readonly', (transaction) =>
    requestResult(transaction.objectStore(name).getAll() as IDBRequest<T[]>)
  )
}

/** Write one record. */
export async function putRecord(name: StoreName, value: unknown, key?: IDBValidKey): Promise<void> {
  await transact([name], 'readwrite', (transaction) =>
    requestResult(transaction.objectStore(name).put(value, key))
  )
}

/** Delete one record. */
export async function deleteRecord(name: StoreName, key: IDBValidKey): Promise<void> {
  await transact([name], 'readwrite', (transaction) => requestResult(transaction.objectStore(name).delete(key)))
}
