import type { z } from 'zod'
import type {
  calendarPostSchema,
  contentDraftRevisionSchema,
  contentDraftSettingsSchema,
  draftAssistContract,
  linkCardSchema,
} from '@/lib/api/contracts/content-draft-platform'
import type {
  contentDraftPostSchema,
  contentDraftScheduleSchema,
  contentDraftSchema,
} from '@/lib/api/contracts/content-drafts'
import type { DraftDiscussions } from '@/lib/content-drafts/discussions'
import type { DraftChannel } from '@/lib/content-drafts/serialize'

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
  channelText?: Partial<Record<DraftChannel, string>>
  discussions?: DraftDiscussions
  plainText?: string
  /** An ISO instant, or an empty string to clear it (an experiment). */
  plannedFor?: string
  status?: 'draft' | 'archived'
  /** Labels (an experiment). */
  tags?: string[]
  title?: string
}

export const draftsApi = {
  create: (input: { body?: unknown[]; socialSetId?: string; title?: string } = {}) =>
    call<DraftWire>(base, { body: input, method: 'POST' }),
  get: (id: string) => call<DraftWire>(one(id)),
  posts: (id: string) => call<{ posts: DraftPostWire[] }>(`${one(id)}/posts`),
  remove: (id: string) => call<{ deleted: true }>(one(id), { method: 'DELETE' }),
  save: (id: string, input: DraftSave) =>
    call<DraftWire>(one(id), { body: input, method: 'PATCH' }),
  schedule: (id: string, input: z.input<typeof contentDraftScheduleSchema>) =>
    call<{ created: boolean; draft: DraftWire; posts: DraftPostWire[] }>(`${one(id)}/schedule`, {
      body: input,
      method: 'POST',
    }),
  review: (id: string, input: { action: 'request' | 'approve' | 'changes'; note?: string }) =>
    call<DraftWire>(`${one(id)}/review`, { body: input, method: 'POST' }),
  share: (id: string, enabled: boolean) =>
    call<DraftWire>(`${one(id)}/share`, { body: { enabled }, method: 'PUT' }),
  revisions: (id: string) => call<{ items: RevisionWire[] }>(`${one(id)}/revisions`),
  revision: (id: string, revisionId: string) =>
    call<RevisionWire>(`${one(id)}/revisions/${encodeURIComponent(revisionId)}`),
  assist: (input: z.input<typeof draftAssistContract.body>) =>
    call<{ posts: string[] }>(`${base}/assist`, { body: input, method: 'POST' }),
  linkCard: (url: string) =>
    call<z.output<typeof linkCardSchema>>(`${base}/link-card?${new URLSearchParams({ url })}`),
  settings: () => call<SettingsWire>('/api/v1/content-draft-settings'),
  saveSettings: (input: Partial<SettingsWire>) =>
    call<SettingsWire>('/api/v1/content-draft-settings', { body: input, method: 'PUT' }),
  bestTimes: (socialSetId?: string) =>
    call<{ items: { at: string; reason: string }[] }>(
      `/api/v1/content-draft-queue/best-times${socialSetId ? `?${new URLSearchParams({ socialSetId })}` : ''}`
    ),
  calendar: (from: Date, to: Date) =>
    call<{ items: CalendarPostWire[] }>(
      `/api/v1/content-draft-posts?${new URLSearchParams({ from: from.toISOString(), to: to.toISOString() })}`
    ),
  movePost: (id: string, scheduledFor: Date) =>
    call<{ post: DraftPostWire }>(`/api/v1/content-draft-posts/${encodeURIComponent(id)}/move`, {
      body: { scheduledFor: scheduledFor.toISOString() },
      method: 'POST',
    }),
  resumeThread: (id: string) =>
    call<{ post: DraftPostWire }>(`/api/v1/content-draft-posts/${encodeURIComponent(id)}/resume`, {
      method: 'POST',
    }),
  refreshMetrics: (id: string) =>
    call<{ post: DraftPostWire }>(`/api/v1/content-draft-posts/${encodeURIComponent(id)}/metrics`, {
      method: 'POST',
    }),
}

/** A saved point in a draft's history, as the API sends it. */
export type RevisionWire = z.output<typeof contentDraftRevisionSchema>

/** The workspace's drafts settings, as the API sends them. */
export type SettingsWire = z.output<typeof contentDraftSettingsSchema>

/** A draft post on the calendar, as the API sends it. */
export type CalendarPostWire = z.output<typeof calendarPostSchema>
