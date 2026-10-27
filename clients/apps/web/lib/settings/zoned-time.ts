/**
 * Wall-clock dates in a named time zone, without a date library (RFC 024).
 * A social set's calendar lays its days out in the set's scheduling zone,
 * whatever zone the reader's browser is in. The rule for clocks that skip or
 * repeat a time matches the backend's queue (resolveWallTime in Go).
 */

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(zone: string): Intl.DateTimeFormat {
  let found = formatters.get(zone)
  if (!found) {
    found = new Intl.DateTimeFormat('en-US', {
      day: 'numeric',
      hour: 'numeric',
      hourCycle: 'h23',
      minute: 'numeric',
      month: 'numeric',
      timeZone: zone,
      year: 'numeric',
    })
    formatters.set(zone, found)
  }
  return found
}

/** The wall-clock date and time `at` reads as in `zone`. */
export function zonedParts(at: Date, zone: string) {
  const parts = Object.fromEntries(formatter(zone).formatToParts(at).map((part) => [part.type, part.value]))
  return {
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    month: Number(parts.month),
    year: Number(parts.year),
  }
}

const pad = (value: number) => String(value).padStart(2, '0')

/** The calendar day `at` falls on in `zone`, as YYYY-MM-DD. */
export function zonedDayKey(at: Date, zone: string): string {
  const { day, month, year } = zonedParts(at, zone)
  return `${year}-${pad(month)}-${pad(day)}`
}

/** A YYYY-MM-DD day `days` later (or earlier). */
export function addDays(dayKey: string, days: number): string {
  const [year, month, day] = dayKey.split('-').map(Number)
  const date = new Date(Date.UTC(year!, month! - 1, day! + days))
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

/** The weekday of a YYYY-MM-DD day (0 is Sunday). */
export function dayOfWeek(dayKey: string): number {
  const [year, month, day] = dayKey.split('-').map(Number)
  return new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay()
}

function offsetAt(at: number, zone: string): number {
  const parts = zonedParts(new Date(at), zone)
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - Math.floor(at / 60_000) * 60_000
}

/**
 * The instant a local wall time names in `zone`. A repeated time is its first
 * occurrence; a skipped one lands the same minutes after the transition.
 */
export function zonedInstant(dayKey: string, hour: number, minute: number, zone: string): Date {
  const [year, month, day] = dayKey.split('-').map(Number)
  const wall = Date.UTC(year!, month! - 1, day!, hour, minute)
  let best: number | null = null
  for (const probe of [-36, -12, 12, 36]) {
    const candidate = wall - offsetAt(wall + probe * 3_600_000, zone)
    const parts = zonedParts(new Date(candidate), zone)
    if (parts.year === year && parts.month === month && parts.day === day && parts.hour === hour && parts.minute === minute) {
      if (best === null || candidate < best) best = candidate
    }
  }
  return new Date(best ?? wall - offsetAt(wall - 36 * 3_600_000, zone))
}
