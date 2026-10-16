import { z } from 'zod'
import type { ProhibitedTermMatch } from 'screenshot-studio-backend-sdk'
import type { CampaignPostStatus } from '@/lib/tenant/campaign-status'

/** The fields of a post a person edits by hand. */
export type PostFields = { callToAction: string; copy: string; title: string }

/** How a hand edit ended: saved, refused for stale copy, or refused for prohibited terms. */
export const postEditOutcomeSchema = z.enum(['saved', 'stale', 'prohibited'])

/** How a hand edit ended. */
export type PostEditOutcome = z.infer<typeof postEditOutcomeSchema>

/** The post as the backend holds it after an edit attempt. */
export type PostSnapshot = PostFields & { status: CampaignPostStatus }

/** What `campaign.updatePost` returns. */
export type PostEditResult =
  | { outcome: typeof postEditOutcomeSchema.enum.saved; post: PostSnapshot }
  | { outcome: typeof postEditOutcomeSchema.enum.stale; post: PostSnapshot }
  | { matches: ProhibitedTermMatch[]; outcome: typeof postEditOutcomeSchema.enum.prohibited }

/** The autosave indicator and any decision the author has to make. */
export type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'failed'; message: string }
  | { kind: 'stale'; theirs: PostSnapshot }
  | { kind: 'prohibited'; matches: ProhibitedTermMatch[] }

/**
 * Why a post cannot be edited, or null when it can. A scheduled post whose
 * delivery was cancelled or failed is editable and returns to draft.
 */
export function postEditBlock(status: CampaignPostStatus, deliveryDead: boolean): string | null {
  if (status === 'PUBLISHED') return 'Published posts can no longer be edited.'
  if (status === 'SCHEDULED' && !deliveryDead) return 'Cancel the schedule to edit this post.'
  return null
}

/** Whether saving an edit sends the post back to draft and voids its approval. */
export function editResetsApproval(status: CampaignPostStatus): boolean {
  return status === 'APPROVED' || status === 'SCHEDULED'
}

/** The post as it would be stored, without nulls. */
export function postFields(post: {
  callToAction: string | null
  copy: string
  title: string | null
}): PostFields {
  return { callToAction: post.callToAction ?? '', copy: post.copy, title: post.title ?? '' }
}

/** Whether two versions of a post say the same thing. */
export function samePostFields(a: PostFields, b: PostFields): boolean {
  return a.copy === b.copy && a.callToAction === b.callToAction && a.title === b.title
}

/** The indicator after a save; a stale or prohibited result needs the author. */
export function saveStateFor(result: PostEditResult): SaveState {
  switch (result.outcome) {
    case 'saved':
      return { kind: 'saved' }
    case 'stale':
      return { kind: 'stale', theirs: result.post }
    case 'prohibited':
      return { kind: 'prohibited', matches: result.matches }
  }
}

/** How the author settles a conflict: take their version, or keep the local text. */
export const postConflictChoiceSchema = z.enum(['reload', 'keep'])

/** How the author settles a conflict. */
export type PostConflictChoice = z.infer<typeof postConflictChoiceSchema>

/**
 * Resolve a conflict without losing either version. Reloading takes their
 * version; keeping mine keeps the local text and bases the next save on their
 * copy, so it overwrites theirs on purpose rather than by accident.
 */
export function resolvePostConflict(
  choice: PostConflictChoice,
  mine: PostFields,
  theirs: PostSnapshot
): { draft: PostFields; expectedCopy: string } {
  return {
    draft: choice === 'reload' ? postFields(theirs) : mine,
    expectedCopy: theirs.copy,
  }
}

/** Counted the way the copy guard counts it: copy plus call to action, as posted. */
export function postLength(copy: string, callToAction: string | null): number {
  return [copy, callToAction].filter(Boolean).join(' ').length
}
