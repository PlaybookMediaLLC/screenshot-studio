import assert from 'node:assert/strict'
import test from 'node:test'
import type { SocialObservation } from 'screenshot-studio-backend-sdk'
import {
  accountObservationBuckets,
  analyticsRange,
  analyticsCSV,
  latestObservations,
  observationBuckets,
} from '@/lib/write/analytics'

const row = (subjectId: string, observedAt: string, likes: number): SocialObservation => ({
  id: subjectId + observedAt,
  subjectId,
  observedAt,
  kind: 'post',
  connectionId: 'account',
  platform: 'x',
  metrics: { likes },
  status: 'available',
  series: [],
})
test('cumulative snapshots count each post once per week, with unknown values absent', () => {
  const rows = [
    row('a', '2026-10-20T10:00:00Z', 5),
    row('a', '2026-10-21T10:00:00Z', 9),
    row('b', '2026-10-21T10:00:00Z', 3),
    { ...row('c', '2026-10-22T10:00:00Z', 0), status: 'unavailable' as const, metrics: {} },
  ]
  assert.equal(latestObservations(rows).length, 3)
  assert.deepEqual(observationBuckets(rows, 'week', 'likes'), [
    { date: '2026-10-19', value: 12, posts: 2 },
  ])
  assert.deepEqual(observationBuckets(rows, 'month', 'impressions'), [
    { date: '2026-10-01', value: null, posts: 0 },
  ])
})
test('CSV escapes quotes, newlines, and spreadsheet formulas while retaining zero values', () => {
  const csv = analyticsCSV([
    { ...row('=HYPERLINK("bad")', '2026-10-21T10:00:00Z', 0), platform: 'line\nbreak' },
  ])
  assert.ok(csv.includes('"\'=HYPERLINK(""bad"")"'))
  assert.ok(csv.includes('"line\nbreak"'))
  assert.ok(csv.endsWith('"0"'))
})

test('account buckets retain the last observed gauge and never sum overlapping periods', () => {
  const samples = [
    {
      ...row('account', '2026-10-20T10:00:00Z', 0),
      kind: 'account' as const,
      series: [
        {
          label: 'Followers',
          average: false,
          data: [
            { date: '2026-10-19', total: '100' },
            { date: '2026-10-20', total: '105' },
          ],
        },
      ],
    },
    {
      ...row('account', '2026-10-22T10:00:00Z', 0),
      kind: 'account' as const,
      series: [
        {
          label: 'Followers',
          average: false,
          data: [
            { date: '2026-10-20', total: '106' },
            { date: '2026-10-21', total: '0' },
            { date: '2026-10-22', total: '' },
          ],
        },
      ],
    },
  ]
  const buckets = accountObservationBuckets(samples, 'week')
  assert.equal(buckets.length, 1)
  assert.equal(buckets[0].value, 0)
  assert.equal(buckets[0].date, '2026-10-21')
})

test('analytics dates include the whole end day and reject invalid or oversized ranges', () => {
  assert.deepEqual(analyticsRange('2026-10-01', '2026-10-31'), {
    start: '2026-10-01',
    end: '2026-10-31',
    from: '2026-10-01T00:00:00.000Z',
    to: '2026-11-01T00:00:00.000Z',
  })
  for (const [from, to] of [
    ['2026-02-30', '2026-03-01'],
    ['2026-10-01', '2026-09-30'],
    ['2024-01-01', '2026-01-01'],
  ])
    assert.throws(() => analyticsRange(from, to))
})
