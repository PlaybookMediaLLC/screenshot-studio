'use client'

import { z } from 'zod'

const errorSchema = z.object({ error: z.string().optional() })

type RequestOptions = Omit<RequestInit, 'body'> & { body?: unknown }

export async function requestJson<T>(
  url: string,
  schema: z.ZodType<T>,
  options: RequestOptions = {}
): Promise<T> {
  const response = await fetch(url, {
    ...options,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    headers: { 'content-type': 'application/json', ...options.headers },
  })
  const payload: unknown = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = errorSchema.safeParse(payload)
    throw new Error(error.data?.error ?? 'The request could not be completed.')
  }
  return schema.parse(payload)
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The request could not be completed.'
}
