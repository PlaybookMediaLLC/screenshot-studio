import { AsyncLocalStorage } from 'node:async_hooks'

/** Lives for one tRPC request, never across requests or mutations. */
export type RequestReads = Map<string, Promise<unknown>>
const currentReads = new AsyncLocalStorage<RequestReads | undefined>()

export function withRequestReads<T>(reads: RequestReads | undefined, run: () => T): T {
  return currentReads.run(reads, run)
}

/** Share in-flight reads, including failures, within the current request only. */
export function requestRead<T>(key: string, read: () => Promise<T>): Promise<T> {
  const reads = currentReads.getStore()
  if (!reads) return read()
  let result = reads.get(key)
  if (!result) {
    result = Promise.resolve().then(read)
    reads.set(key, result)
  }
  return result as Promise<T>
}
