'use client'

import { z } from 'zod'
import { isPlanRefusal, PLAN_REFUSAL_MESSAGE } from '@/lib/api/platform-errors'

const errorSchema = z.object({ code: z.string().optional(), error: z.string().optional() })

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
    // The code rides along, so a plan refusal can be told apart from a fault.
    throw Object.assign(new Error(error.data?.error ?? 'The request could not be completed.'), {
      code: error.data?.code,
    })
  }
  return schema.parse(payload)
}

export function getErrorMessage(error: unknown): string {
  if (isPlanRefusal(error)) return PLAN_REFUSAL_MESSAGE
  return error instanceof Error ? error.message : 'The request could not be completed.'
}
