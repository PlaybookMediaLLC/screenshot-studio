import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isTimeZone,
  naturalOffsetMinutes,
  offsetLabel,
  resolveLocalTime,
  wallTime,
} from '@/lib/write/zoned-time'

test('an ordinary local time names one instant', () => {
  const result = resolveLocalTime('2026-07-01T12:00', 'Europe/Paris')
  assert.equal(result.kind, 'exact')
  if (result.kind === 'exact') assert.equal(result.at.toISOString(), '2026-07-01T10:00:00.000Z')
  const tokyo = resolveLocalTime('2026-01-15T09:30', 'Asia/Tokyo')
  assert.ok(tokyo.kind === 'exact' && tokyo.at.toISOString() === '2026-01-15T00:30:00.000Z')
})

test('a time the clocks skip names no instant', () => {
  // US clocks go from 01:59 to 03:00 on 8 March 2026.
  assert.deepEqual(resolveLocalTime('2026-03-08T02:30', 'America/New_York'), { kind: 'gap' })
  // Europe goes from 01:59 UTC (02:59 CET) to 04:00 CEST on 29 March 2026.
  assert.deepEqual(resolveLocalTime('2026-03-29T02:15', 'Europe/Paris'), { kind: 'gap' })
})

test('a time the clocks repeat names two instants, an hour apart', () => {
  const result = resolveLocalTime('2026-11-01T01:30', 'America/New_York')
  assert.equal(result.kind, 'ambiguous')
  if (result.kind === 'ambiguous') {
    assert.equal(result.earlier.toISOString(), '2026-11-01T05:30:00.000Z')
    assert.equal(result.later.toISOString(), '2026-11-01T06:30:00.000Z')
  }
})

test('half-hour zones and UTC resolve exactly', () => {
  const india = resolveLocalTime('2026-05-05T08:00', 'Asia/Kolkata')
  assert.ok(india.kind === 'exact' && india.at.toISOString() === '2026-05-05T02:30:00.000Z')
  const utc = resolveLocalTime('2026-05-05T08:00', 'UTC')
  assert.ok(utc.kind === 'exact' && utc.at.toISOString() === '2026-05-05T08:00:00.000Z')
  assert.equal(offsetLabel(new Date('2026-05-05T08:00:00Z'), 'Asia/Kolkata'), 'UTC+05:30')
  assert.equal(offsetLabel(new Date('2026-01-05T08:00:00Z'), 'America/New_York'), 'UTC−05:00')
})

test('wall time round-trips and zones are checked', () => {
  assert.equal(wallTime(new Date('2026-07-01T10:00:00Z'), 'Europe/Paris'), '2026-07-01T12:00')
  assert.equal(isTimeZone('Europe/Paris'), true)
  assert.equal(isTimeZone('Mars/Olympus'), false)
  assert.throws(() => resolveLocalTime('tomorrow', 'UTC'))
})

test('the natural offset is stable per key and within four minutes', () => {
  const offsets = new Set<number>()
  for (let index = 0; index < 500; index += 1) {
    const offset = naturalOffsetMinutes(`draft-${index}:v3`)
    assert.ok(offset >= -4 && offset <= 4)
    assert.equal(naturalOffsetMinutes(`draft-${index}:v3`), offset)
    offsets.add(offset)
  }
  assert.equal(offsets.size, 9)
})
