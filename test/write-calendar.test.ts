import assert from 'node:assert/strict'
import test from 'node:test'
import { availableDaySlots } from '@/lib/write/calendar'

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
