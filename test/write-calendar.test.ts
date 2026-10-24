import assert from 'node:assert/strict'
import test from 'node:test'
import {
  availableDaySlots,
  calendarRange,
  shiftCalendar,
  calendarMoveTime,
} from '@/lib/write/calendar'

test('TF-053/081: month boundaries cover every day and preserve the chosen first weekday', () => {
  assert.deepEqual(calendarRange('2026-10-31', 'month', 1), {
    start: '2026-09-28',
    end: '2026-11-09',
    days: 42,
  })
  assert.equal(calendarRange('2026-11-01', 'month', 0).start, '2026-11-01')
  assert.equal(shiftCalendar('2026-01-31', 'month', 1), '2026-02-01')
  assert.equal(shiftCalendar('2026-12-31', 'month', 1), '2027-01-01')
})

test('TF-054/081: drops refuse DST ambiguity instead of silently changing the intended time', () => {
  assert.throws(
    () => calendarMoveTime('2026-11-01', '01:30', 'America/New_York'),
    /daylight saving/
  )
  assert.throws(
    () => calendarMoveTime('2027-03-14', '02:30', 'America/New_York'),
    /daylight saving/
  )
  assert.equal(
    calendarMoveTime('2026-11-02', '09:00', 'America/New_York').toISOString(),
    '2026-11-02T14:00:00.000Z'
  )
})

test('calendar offers only future, unoccupied slots on the selected brand day', () => {
  const slots = [
    { weekday: 2, time: '09:00' },
    { weekday: 2, time: '10:00' },
    { weekday: 2, time: '11:00' },
    { weekday: 2, time: '11:00' },
    { weekday: 3, time: '12:00' },
  ]
  assert.deepEqual(
    availableDaySlots(
      '2026-10-20',
      'America/New_York',
      slots,
      ['2026-10-20T14:03:00Z'],
      new Date('2026-10-20T13:30:00Z')
    ),
    ['11:00']
  )
})

test('calendar omits daylight saving gaps and ambiguous slots', () => {
  const slots = [
    { weekday: 0, time: '01:30' },
    { weekday: 0, time: '02:30' },
    { weekday: 0, time: '03:30' },
  ]
  assert.deepEqual(
    availableDaySlots('2027-03-14', 'America/New_York', slots, [], new Date('2027-01-01')),
    ['01:30', '03:30']
  )
  assert.deepEqual(
    availableDaySlots('2026-11-01', 'America/New_York', slots, [], new Date('2026-01-01')),
    ['02:30', '03:30']
  )
})
