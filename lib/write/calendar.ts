import { resolveLocalTime } from './zoned-time'

/** Free future slots on a calendar day; repeated or skipped wall times need manual review. */
export function availableDaySlots(
  day: string,
  zone: string,
  slots: { weekday: number; time: string }[],
  taken: string[],
  now = new Date()
): string[] {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay()
  return [...new Set(slots.filter((slot) => slot.weekday === weekday).map((slot) => slot.time))]
    .filter((time) => {
      const resolved = resolveLocalTime(`${day}T${time}`, zone)
      return (
        resolved.kind === 'exact' &&
        resolved.at > now &&
        !taken.some((at) => Math.abs(new Date(at).getTime() - resolved.at.getTime()) < 5 * 60_000)
      )
    })
    .sort()
}

/** Visible calendar days, including adjacent weeks in month view. */
export function calendarRange(anchor: string, view: 'week' | 'month' | 'queue', firstWeekday = 1) {
  const parsed = new Date(`${anchor}T12:00:00Z`)
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(anchor) ||
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== anchor
  ) {
    throw new Error('Choose a valid calendar date.')
  }
  const start = new Date(parsed)
  if (view === 'month') start.setUTCDate(1)
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() - firstWeekday + 7) % 7))
  const days = view === 'month' ? 42 : 7
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + days)
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), days }
}

/** Navigate months from their first day so January 31 never skips February. */
export function shiftCalendar(
  anchor: string,
  view: 'week' | 'month' | 'queue',
  delta: number
): string {
  const date = new Date(`${anchor}T12:00:00Z`)
  if (view === 'month') {
    date.setUTCDate(1)
    date.setUTCMonth(date.getUTCMonth() + delta)
  } else date.setUTCDate(date.getUTCDate() + delta * 7)
  return date.toISOString().slice(0, 10)
}
