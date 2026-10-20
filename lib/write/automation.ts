import type { Automation, RetweetRule } from '@/lib/write/document'
import { resolveLocalTime, wallTime } from '@/lib/write/zoned-time'

/**
 * Follow-ups as people read them (RFC 042): when each automatic repost
 * lands for a given publish time, and what happens after a post is live.
 * Go plans the same times from the same rules when the post goes out.
 */

/** How long a plug waits for its threshold, as the backend checks it. */
export const PLUG_WINDOW_HOURS = 48

/**
 * Why Auto-DM is off. The workspace's X connection is authorized without
 * direct-message access, and X sends DMs only on paid API plans.
 */
export const AUTO_DM_UNAVAILABLE =
  'Auto-DM is not available: this workspace connects to X without direct-message access, and X sends direct messages only on paid API plans. Nothing is sent.'

/** Reposts a new set starts with: six hours after publishing, removed 12 hours later. */
export const DEFAULT_AUTOMATION: Automation = {
  retweets: [{ afterMinutes: 360 }],
  unretweetAfterMinutes: 720,
}

/** When a rule reposts a post published at `publishedAt`; null when it cannot be worked out. */
export function retweetAt(rule: RetweetRule, publishedAt: Date): Date | null {
  if ('afterMinutes' in rule) return new Date(publishedAt.getTime() + rule.afterMinutes * 60_000)
  try {
    const [year, month, day] = wallTime(publishedAt, rule.timeZone)
      .slice(0, 10)
      .split('-')
      .map(Number)
    const date = new Date(Date.UTC(year, month - 1, day + rule.days)).toISOString().slice(0, 10)
    const resolved = resolveLocalTime(`${date}T${rule.at}`, rule.timeZone)
    if (resolved.kind === 'exact') return resolved.at
    if (resolved.kind === 'ambiguous') return resolved.earlier
    // A time the clocks skip lands the length of the skip later, as in Go.
    const [hours, minutes] = rule.at.split(':').map(Number)
    const later = `${String(hours + 1).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
    const shifted = resolveLocalTime(`${date}T${later}`, rule.timeZone)
    return shifted.kind === 'exact' ? shifted.at : null
  } catch {
    return null
  }
}

/** A rule in words: "6 hours after publishing", "2 days later at 10:30". */
export function ruleLabel(rule: RetweetRule): string {
  if ('afterMinutes' in rule) {
    const { afterMinutes: minutes } = rule
    if (minutes % 1_440 === 0)
      return `${minutes / 1_440} day${minutes === 1_440 ? '' : 's'} after publishing`
    if (minutes % 60 === 0)
      return `${minutes / 60} hour${minutes === 60 ? '' : 's'} after publishing`
    return `${minutes} minutes after publishing`
  }
  if (rule.days === 0) return `The same day at ${rule.at}`
  return `${rule.days} day${rule.days === 1 ? '' : 's'} later at ${rule.at}`
}

/** What happens after a post is live, one line each. */
export function followUpLines(
  automation: Automation | undefined,
  firstComment: string | undefined,
  label: string
): string[] {
  const lines: string[] = []
  if (firstComment?.trim()) lines.push(`${label}: comment under the post right after it goes out.`)
  for (const rule of automation?.retweets ?? []) {
    const removal = automation?.unretweetAfterMinutes
      ? `, removed ${durationLabel(automation.unretweetAfterMinutes)} later`
      : ''
    lines.push(`${label}: repost ${ruleLabel(rule).toLowerCase()}${removal}.`)
  }
  if (automation?.plugAtLikes) {
    const metric = automation.plugMetric === 'reposts' ? 'reposts' : 'likes'
    lines.push(
      `${label}: reply with the plug once at ${automation.plugAtLikes} ${metric}, checked for ${PLUG_WINDOW_HOURS} hours.`
    )
  }
  if (automation?.repostAtLikes) {
    lines.push(`${label}: repost once at ${automation.repostAtLikes} likes.`)
  }
  if (automation?.quoteAfterHours) {
    lines.push(`${label}: quote the post ${automation.quoteAfterHours} hours after it goes out.`)
  }
  return lines
}

/** Minutes as "12 hours", "2 days", "45 minutes". */
export function durationLabel(minutes: number): string {
  if (minutes % 1_440 === 0) return `${minutes / 1_440} day${minutes === 1_440 ? '' : 's'}`
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? '' : 's'}`
  return `${minutes} minutes`
}
