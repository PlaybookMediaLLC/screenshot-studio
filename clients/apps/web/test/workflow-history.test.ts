import assert from 'node:assert/strict'
import test from 'node:test'
import { runDateBoundary, runDateDay } from '../lib/workflows/history'
import { automationHistoryFilterSchema } from '../lib/api/contracts/workflow-runs'

test('local run dates include the complete selected day across DST and timezones', () => {
  const previous = process.env.TZ
  try {
    for (const [zone, day, start, end] of [
      ['America/New_York', '2026-10-20', '2026-10-20T04:00:00.000Z', '2026-10-21T04:00:00.000Z'],
      ['America/New_York', '2026-03-08', '2026-03-08T05:00:00.000Z', '2026-03-09T04:00:00.000Z'],
      ['America/New_York', '2026-11-01', '2026-11-01T04:00:00.000Z', '2026-11-02T05:00:00.000Z'],
      ['Asia/Tokyo', '2026-10-20', '2026-10-19T15:00:00.000Z', '2026-10-20T15:00:00.000Z'],
    ]) {
      process.env.TZ = zone
      assert.equal(runDateBoundary(day), start)
      assert.equal(runDateBoundary(day, true), end)
      assert.equal(runDateDay(start), day)
      assert.equal(runDateDay(end, true), day)
      assert.equal(
        automationHistoryFilterSchema.safeParse({ since: start, until: end }).success,
        true
      )
    }
  } finally {
    if (previous === undefined) delete process.env.TZ
    else process.env.TZ = previous
  }
})

test('run history rejects inverted or empty ranges and preserves cursor and intake mode', () => {
  const since = '2026-10-21T04:00:00.000Z'
  for (const until of [since, '2026-10-20T04:00:00.000Z'])
    assert.equal(automationHistoryFilterSchema.safeParse({ since, until }).success, false)
  assert.equal(
    automationHistoryFilterSchema.safeParse({
      since: '2026-10-21T04:00:00.500Z',
      until: '2026-10-21T04:00:00Z',
    }).success,
    false
  )
  assert.deepEqual(
    automationHistoryFilterSchema.parse({ before: 'run-50', mode: 'legacy', status: 'skipped' }),
    { before: 'run-50', mode: 'legacy', status: 'skipped' }
  )
})
