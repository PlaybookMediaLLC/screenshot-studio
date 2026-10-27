import assert from 'node:assert/strict'
import test from 'node:test'
import { postingTimeBuckets } from '@/lib/write/posting-times'

test('posting charts distinguish unmeasured posts, measured zero, and local weekday boundaries', () => {
  const post = {
    status: 'PUBLISHED',
    scheduledFor: '2026-10-25T01:00:00Z',
    metricsAt: '2026-10-26T01:00:00Z',
  }
  const days = postingTimeBuckets(
    [
      { ...post, metrics: { likes: 10, replies: 2, impressions: 99999 } },
      { ...post, metrics: { likes: 0 } },
      { ...post, metrics: { impressions: 99 } },
      { ...post, metrics: { likes: 200 }, metricsAt: null },
      { ...post, metrics: { likes: 200 }, status: 'SCHEDULED' },
    ],
    'America/New_York'
  )
  assert.deepEqual(days[6][21], { weekday: 6, hour: 21, count: 2, total: 12, average: 6 })
  assert.equal(
    days.flat().reduce((sum, hour) => sum + hour.count, 0),
    2
  )
  assert.equal(days[0][1].count, 0)
})
