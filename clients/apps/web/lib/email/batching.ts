/**
 * Provider batching limits, kept free of any server-only import.
 *
 * `transport.ts` imports the Resend client and is marked `server-only`.
 * Chunking is pure arithmetic, so it lives here where route handlers,
 * tests, and job code can use it without pulling a server-only module
 * into their graph.
 */

/**
 * Resend accepts at most 100 messages per batch request. Exceeding it
 * fails the whole call, so bulk sends are chunked rather than truncated.
 */
export const RESEND_BATCH_LIMIT = 100

/**
 * Split a list into fixed-size batches, preserving order and dropping
 * nothing. A dropped or duplicated recipient is the failure mode that
 * matters here: one means a customer never hears about a release, the
 * other means they hear twice.
 */
export function chunk<T>(items: T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) {
    throw new Error('Chunk size must be a positive integer.')
  }

  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}
