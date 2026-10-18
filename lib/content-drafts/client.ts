import type { z } from 'zod'
import type { contentDraftPostSchema, contentDraftSchema } from '@/lib/api/contracts/content-drafts'
import type { DraftDiscussions } from '@/lib/content-drafts/discussions'

/**
 * Browser calls to the content draft API (`/api/v1/content-drafts`), with the
 * session cookie. The routes answer the platform error envelope; its message
 * becomes the error, and its status says what to do (409: reload).
 */

/** A draft as the API sends it, with ISO timestamps. */
export type DraftWire = z.output<typeof contentDraftSchema>

/** A post scheduled from a draft, as the API sends it. */
export type DraftPostWire = z.output<typeof contentDraftPostSchema>

export class DraftRequestError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'DraftRequestError'
  }
}

async function call<T>(path: string, init: { body?: unknown; method?: string } = {}): Promise<T> {
  const response = await fetch(path, {
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
    method: init.method ?? 'GET',
  })
  const body = (await response.json().catch(() => null)) as {
    error?: string
    message?: string
  } | null
  if (!response.ok) {
    throw new DraftRequestError(
      body?.message ?? body?.error ?? `The request failed (${response.status}).`,
      response.status
    )
  }
  return body as T
}

const base = '/api/v1/content-drafts'
const one = (id: string) => `${base}/${encodeURIComponent(id)}`

/** Fields a save writes; `baseVersion` is the version the editor last saw. */
export type DraftSave = {
  assetIds?: string[]
  baseVersion: number
  body?: unknown[]
  channelConnectionIds?: string[]
  discussions?: DraftDiscussions
  plainText?: string
  status?: 'draft' | 'archived'
  title?: string
}

export const draftsApi = {
  create: (input: { body?: unknown[]; title?: string } = {}) =>
    call<DraftWire>(base, { body: input, method: 'POST' }),
  get: (id: string) => call<DraftWire>(one(id)),
  posts: (id: string) => call<{ posts: DraftPostWire[] }>(`${one(id)}/posts`),
  remove: (id: string) => call<{ deleted: true }>(one(id), { method: 'DELETE' }),
  save: (id: string, input: DraftSave) =>
    call<DraftWire>(one(id), { body: input, method: 'PATCH' }),
  schedule: (
    id: string,
    input: {
      blockImages: (string | null)[]
      channelConnectionIds: string[]
      scheduledFor: string
      version: number
    }
  ) =>
    call<{ created: boolean; draft: DraftWire; posts: DraftPostWire[] }>(`${one(id)}/schedule`, {
      body: input,
      method: 'POST',
    }),
}
