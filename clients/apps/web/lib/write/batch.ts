import type { BatchItem, BatchTiming } from '@/lib/api/contracts/content-batches'
import type { DraftChannel } from '@/lib/write/document'
import { mediaChanges, mediaProblems, type MediaFacts } from '@/lib/write/media-rules'
import { resolveLocalTime, wallTime } from '@/lib/write/zoned-time'

/**
 * Bulk batch view logic (RFC 042), kept apart from the page so it can be
 * tested: which item and account combinations can go, when each item is
 * meant to go out, and what happened to each one after scheduling.
 */

/** An account of the batch's set that an item can go to. */
export type BatchAccount = { channel: DraftChannel; id: string; name: string }

/**
 * An item's media facts once every attachment is uploaded; null while one is
 * not, so nothing is judged on partial facts.
 */
export function batchMediaFacts(media: BatchItem['media']): MediaFacts[] | null {
  const facts: MediaFacts[] = []
  for (const item of media) {
    if (item.status !== 'UPLOADED' || !item.mediaType) return null
    facts.push({
      bytes: item.bytes,
      durationMs: item.durationMs,
      height: item.height,
      mimeType: item.mediaType,
      width: item.width,
    })
  }
  return facts
}

/** A PDF item goes to LinkedIn alone, as the post's document. */
function documentProblems(channel: DraftChannel, facts: MediaFacts[]) {
  if (channel !== 'linkedin')
    return ['Only LinkedIn posts a PDF, as a document. Remove this account or the PDF.']
  if (facts.length > 1)
    return ['A LinkedIn document goes alone: remove the images or the document.']
  return []
}

/**
 * For each chosen account: what blocks the item there, from the media rules
 * Go also applies, and what Shots would change before sending it.
 */
export function stagedChecks(item: BatchItem, accounts: BatchAccount[]) {
  const facts = batchMediaFacts(item.media)
  const pdf = facts?.some((fact) => fact.mimeType === 'application/pdf')
  return new Map(
    accounts
      .filter((account) => item.channelConnectionIds.includes(account.id))
      .map((account) => [
        account.id,
        {
          changes: facts && !pdf ? mediaChanges(account.channel, facts) : [],
          problems: !facts
            ? ['Finish uploading this item’s files first.']
            : pdf
              ? documentProblems(account.channel, facts)
              : mediaProblems(account.channel, facts),
        },
      ])
  )
}

/** When an item is meant to go out, or why that cannot be read yet. */
export type TimingView =
  | { kind: 'unset'; text: string }
  | { at: Date; kind: 'at'; text: string; zone: string }
  | { kind: 'problem'; text: string }

/** Read an item's intended time as the backend will, in its own zone. */
export function readTiming(timing: BatchTiming, now = new Date()): TimingView {
  if (timing.mode === 'queue') {
    if (!timing.expectedQueueSlot)
      return { kind: 'problem', text: 'Preview the queue to give this item a slot.' }
    const at = new Date(timing.expectedQueueSlot)
    return { at, kind: 'at', text: 'Next free queue slot', zone: '' }
  }
  if (timing.mode !== 'time' || !timing.localTime || !timing.timeZone)
    return { kind: 'unset', text: 'Choose a time or the queue.' }
  const resolved = resolveLocalTime(timing.localTime, timing.timeZone)
  if (resolved.kind === 'gap')
    return {
      kind: 'problem',
      text: `${timing.localTime.replace('T', ' ')} doesn’t exist in ${timing.timeZone}: the clocks skip it. Pick another time.`,
    }
  const at =
    resolved.kind === 'exact'
      ? resolved.at
      : timing.disambiguation
        ? resolved[timing.disambiguation]
        : null
  if (!at)
    return {
      kind: 'problem',
      text: `${timing.localTime.replace('T', ' ')} happens twice in ${timing.timeZone} as the clocks go back. Choose the earlier or the later one.`,
    }
  if (at.getTime() <= now.getTime() + 60_000)
    return { kind: 'problem', text: 'Pick a time in the future.' }
  return { at, kind: 'at', text: timing.localTime.replace('T', ' '), zone: timing.timeZone }
}

/** Previewed Spread instants as wall times in the batch's zone, kept with the zone. */
export function spreadTimings(times: string[], zone: string): BatchTiming[] {
  return times.map((at) => ({
    mode: 'time',
    localTime: wallTime(new Date(at), zone),
    timeZone: zone,
  }))
}

/** Previewed queue slots, sent back so a slot taken meanwhile is refused, not moved. */
export function queueTimings(times: string[]): BatchTiming[] {
  return times.map((at) => ({ mode: 'queue', expectedQueueSlot: at }))
}

/**
 * What happened to an item on one account: its newest scheduled post that
 * was not cancelled, or none. Status comes from the post, the one record.
 */
export function postOn(item: BatchItem, accountId: string) {
  return (
    item.posts
      .filter((post) => post.channelConnectionId === accountId && post.status !== 'CANCELLED')
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] ?? null
  )
}

/** Words for a post's status, as the person reads them. */
export const POST_STATUS: Record<string, string> = {
  DRAFT: 'Draft',
  SCHEDULED: 'Scheduled',
  PROCESSING: 'Publishing',
  PUBLISHED: 'Published',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
  UNKNOWN_DELIVERY: 'Uncertain: check the account',
}

/** The accounts an item still needs scheduled to, and whether it already has live posts. */
export function pendingAccounts(item: BatchItem, accountIds: string[]) {
  const live = accountIds.filter((id) => {
    const post = postOn(item, id)
    return post && post.status !== 'FAILED'
  })
  return {
    add: item.posts.some((post) => post.status !== 'CANCELLED' && post.status !== 'FAILED'),
    remaining: accountIds.filter((id) => !live.includes(id)),
  }
}
