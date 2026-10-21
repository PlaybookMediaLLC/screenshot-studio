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
