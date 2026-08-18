import type { Page } from '@playwright/test'
import { browserRequest } from './browser'

type TRPCResponse = {
  body: unknown
  status: number
}

/**
 * Unwraps a single-call tRPC + superjson envelope. Success payloads live at
 * result.data.json; error payloads keep their tRPC error shape so callers
 * can assert on messages.
 */
function unwrapTRPCBody(body: unknown): unknown {
  if (typeof body !== 'object' || body === null) return body
  if ('result' in body) {
    const result = (body as { result: { data?: { json?: unknown } } }).result
    return result.data?.json ?? null
  }
  if ('error' in body) {
    const error = (body as { error: { json?: unknown } }).error
    return error.json ?? error
  }
  return body
}

export async function trpcQuery(
  page: Page,
  path: string,
  input?: unknown,
  headers: Record<string, string> = {}
): Promise<TRPCResponse> {
  const search =
    input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`
  const response = await browserRequest(page, `/api/trpc/${path}${search}`, { headers })
  return { body: unwrapTRPCBody(response.body), status: response.status }
}

export async function trpcMutation(
  page: Page,
  path: string,
  input: unknown,
  headers: Record<string, string> = {}
): Promise<TRPCResponse> {
  const response = await browserRequest(page, `/api/trpc/${path}`, {
    body: JSON.stringify({ json: input }),
    headers: { 'content-type': 'application/json', ...headers },
    method: 'POST',
  })
  return { body: unwrapTRPCBody(response.body), status: response.status }
}
