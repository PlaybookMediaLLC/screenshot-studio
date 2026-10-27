import assert from 'node:assert/strict'
import test from 'node:test'
import { startOfWeek } from '@/lib/settings/appearance'
import { addDays, dayOfWeek, zonedDayKey, zonedInstant } from '@/lib/settings/zoned-time'

test('a wall time resolves the way the backend queue does across daylight saving', () => {
  // 2026-03-08 New York skips 02:00 to 03:00: 02:30 fires at 03:30 EDT.
  assert.equal(
    zonedInstant('2026-03-08', 2, 30, 'America/New_York').toISOString(),
    '2026-03-08T07:30:00.000Z'
  )
  // 2026-11-01 repeats 01:00 to 02:00: 01:30 fires at its first occurrence.
  assert.equal(
    zonedInstant('2026-11-01', 1, 30, 'America/New_York').toISOString(),
    '2026-11-01T05:30:00.000Z'
  )
  assert.equal(
    zonedInstant('2026-11-02', 12, 30, 'America/New_York').toISOString(),
    '2026-11-02T17:30:00.000Z'
  )
  assert.equal(
    zonedInstant('2026-11-02', 9, 0, 'Asia/Kolkata').toISOString(),
    '2026-11-02T03:30:00.000Z'
  )
})

test('a calendar day is the day in the set zone, not the browser zone', () => {
  const at = new Date('2026-11-02T03:30:00.000Z')
  assert.equal(zonedDayKey(at, 'Asia/Tokyo'), '2026-11-02')
  assert.equal(zonedDayKey(at, 'America/Los_Angeles'), '2026-11-01')
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
  assert.equal(dayOfWeek('2026-11-02'), 1)
})

test('the week starts on the chosen day and stored instants never move', () => {
  const wednesday = new Date(2026, 10, 4, 15, 0)
  assert.equal(startOfWeek(wednesday, 'monday').getDay(), 1)
  assert.equal(startOfWeek(wednesday, 'monday').getDate(), 2)
  assert.equal(startOfWeek(wednesday, 'sunday').getDay(), 0)
  assert.equal(startOfWeek(wednesday, 'sunday').getDate(), 1)
  assert.equal(wednesday.getHours(), 15)
})
