/**
 * How a scheduled destination reads to a person (RFC 013): its state,
 * including a queued post whose time passed without it starting, and why it
 * did not publish, in words they can act on. Pure, so the composer and the
 * calendar share it and plain Node tests it.
 */

/** A post's stored status. */
export type ScheduledPostStatus =
  'DRAFT' | 'SCHEDULED' | 'PROCESSING' | 'PUBLISHED' | 'FAILED' | 'CANCELLED' | 'UNKNOWN_DELIVERY'

/** What a person reads for one destination. */
export type PostState =
  'Scheduled' | 'Overdue' | 'Publishing' | 'Published' | 'Failed' | 'Needs check' | 'Cancelled'

/**
 * A queued post this long past its time is overdue: the dispatcher starts
 * due posts every minute, so a longer wait means its worker is behind. After
 * an hour it is not sent at all (MISSED_WINDOW).
 */
export const OVERDUE_AFTER_MS = 5 * 60_000

/** The state of a destination at `now`. */
export function postState(
  status: ScheduledPostStatus,
  scheduledFor: string | Date,
  now = Date.now()
): PostState {
  switch (status) {
    case 'SCHEDULED':
    case 'DRAFT':
      return new Date(scheduledFor).getTime() + OVERDUE_AFTER_MS < now ? 'Overdue' : 'Scheduled'
    case 'PROCESSING':
      return 'Publishing'
    case 'PUBLISHED':
      return 'Published'
    case 'FAILED':
      return 'Failed'
    case 'UNKNOWN_DELIVERY':
      return 'Needs check'
    case 'CANCELLED':
      return 'Cancelled'
  }
}

/** Why a destination did not publish, or null when nothing went wrong. */
export function postFailureReason(code: string | null | undefined): string | null {
  switch (code) {
    case null:
    case undefined:
    case '':
      return null
    case 'MEDIA_UNAVAILABLE':
      return 'An attachment was deleted or is unavailable, so nothing was sent. Restore it and schedule again.'
    case 'MISSED_WINDOW':
      return 'Publishing could not start within an hour of its time, so it was not sent. Publish it now or reschedule it.'
    case 'APPROVAL_REQUIRED':
      return 'This version is not approved, so it was not sent. Get it approved, then schedule again.'
    case 'ACCOUNT_UNAVAILABLE':
      return 'The account was disconnected or removed, so it was not sent. Reconnect it, then schedule again.'
    case 'WORKSPACE_INACTIVE':
      return 'The workspace or this content is no longer active, so it was not sent.'
    case 'UNKNOWN_DELIVERY':
      return 'The platform did not confirm the result. It may already be live.'
    case 'NETWORK':
      return 'The platform could not be reached. Retry it.'
    case '429':
      return 'The platform kept rate-limiting this post. Retry it later.'
    case '401':
    case '403':
      return 'The platform refused the account’s permission. Reconnect it, then retry.'
  }
  if (/^5\d\d$/.test(code)) return 'The platform had an error. Retry it.'
  if (/^4\d\d$/.test(code))
    return 'The platform rejected the post. Check its text and media before retrying.'
  return `It did not publish (${code}).`
}
