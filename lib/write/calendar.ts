import { resolveLocalTime } from './zoned-time'
import { addDays, dayOfWeek } from '@/lib/settings/zoned-time'

/** Dragging an authored draft opens scheduling review; it never creates a job. */
export const CALENDAR_DRAFT_DRAG = 'application/x-shots-calendar-draft'

/** Calendar intervals use local dates, including all leading/trailing month days. */
export function calendarRange(day: string, view: 'week' | 'month' | 'queue', firstWeekday: number) {
  const anchor = view === 'month' ? `${day.slice(0, 7)}-01` : day
  const start = addDays(anchor, -((dayOfWeek(anchor) - firstWeekday + 7) % 7))
  return { start, end: addDays(start, view === 'month' ? 42 : 7), days: view === 'month' ? 42 : 7 }
}

/** Advance a calendar period without overflowing short months or shifting time zones. */
export function shiftCalendar(day: string, view: 'week' | 'month' | 'queue', step: number): string {
  if (view !== 'month') return addDays(day, step * 7)
  const [year, month] = day.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1 + step, 1)).toISOString().slice(0, 10)
}

/** A move never guesses which occurrence of an ambiguous local time was intended. */
export function calendarMoveTime(day: string, clock: string, zone: string): Date {
  const time = resolveLocalTime(`${day}T${clock}`, zone)
  if (time.kind !== 'exact')
    throw new Error(
      'This time is skipped or repeated by daylight saving. Choose a time in the schedule dialog.'
    )
  return time.at
}

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
