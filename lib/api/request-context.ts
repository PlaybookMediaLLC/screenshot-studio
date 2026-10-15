import { randomUUID } from 'node:crypto'
import { z } from 'zod'

/** Request headers the platform API reads or writes, named once. */
export const platformHeaderSchema = z.enum([
  'cache-control',
  'idempotency-key',
  'x-api-key',
  'x-playbook-client',
  'x-request-id',
  'x-screenshot-studio-maintenance-secret',
  'x-screenshot-studio-signature',
])

/** One of {@link platformHeaderSchema}. */
export type PlatformHeader = z.infer<typeof platformHeaderSchema>

/** The platform header names, keyed by themselves: `platformHeaders['x-request-id']`. */
export const platformHeaders = platformHeaderSchema.enum

/**
 * A caller-supplied correlation id. It is forwarded to the Go backend and
 * written to logs, so it must be short and free of separators.
 */
export const requestIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[\w.:-]+$/)

const requestIds = new WeakMap<Headers, string>()

/**
 * The request's correlation id: the caller's `x-request-id` when it passes
 * {@link requestIdSchema}, otherwise one minted for the request. The same
 * `Headers` object always yields the same id, so every log line and backend
 * call for one request correlates.
 */
export function getRequestId(headers: Headers): string {
  let requestId = requestIds.get(headers)
  if (!requestId) {
    const supplied = requestIdSchema.safeParse(headers.get(platformHeaders['x-request-id']))
    requestId = supplied.success ? supplied.data : randomUUID()
    requestIds.set(headers, requestId)
  }
  return requestId
}
