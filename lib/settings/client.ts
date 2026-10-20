'use client'

import { z } from 'zod'
import { debugLog, redactPath } from '@/lib/debug-log'

/** A settings request the server refused, with its status and error code. */
export class SettingsRequestError extends Error {
  /** The HTTP status. */
  readonly status: number
  /** The platform error code, such as `conflict`. */
  readonly code: string | null

  /** A refusal with its message, status and code. */
  constructor(message: string, status: number, code: string | null) {
    super(message)
    this.name = 'SettingsRequestError'
    this.status = status
    this.code = code
  }
}

const failureSchema = z.object({
  code: z.string().optional(),
  error: z.string().optional(),
  message: z.string().optional(),
})

/**
 * Calls a settings route and parses its answer with the contract's schema, so
 * a value the server did not send never reaches the UI.
 */
export async function settingsRequest<Schema extends z.ZodType>(
  path: string,
  schema: Schema,
  options: { body?: unknown; method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE' } = {}
): Promise<z.output<Schema>> {
  const method = options.method ?? 'GET'
  const started = performance.now()
  const response = await fetch(path, {
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: 'same-origin',
    headers: options.body === undefined ? undefined : { 'content-type': 'application/json' },
    method,
  })
  debugLog('request', `${method} ${redactPath(path)} ${response.status}`, {
    durationMs: Math.round(performance.now() - started),
    requestId: response.headers.get('x-request-id'),
  })
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const failure = failureSchema.safeParse(payload)
    throw new SettingsRequestError(
      failure.data?.message ?? failure.data?.error ?? 'The request could not be completed.',
      response.status,
      failure.data?.code ?? null
    )
  }
  return schema.parse(payload)
}

/** A person-readable message for any failure. */
export function settingsErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The request could not be completed.'
}
