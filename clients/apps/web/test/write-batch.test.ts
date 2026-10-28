import assert from 'node:assert/strict'
import test from 'node:test'
import type { BatchItem } from '@/lib/api/contracts/content-batches'
import {
  pendingAccounts,
  postOn,
  queueTimings,
  readTiming,
  spreadTimings,
  stagedChecks,
} from '@/lib/write/batch'

const item = (overrides: Partial<BatchItem> = {}): BatchItem => ({
  caption: 'Caption',
  channelConnectionIds: ['ig', 'li'],
  draft: null,
  draftId: null,
  id: 'item',
  importKey: 'item-import-key-0001',
  media: [
    {
      assetId: 'a',
      bytes: 1000,
      durationMs: null,
      height: 2000,
      mediaType: 'image/png',
      status: 'UPLOADED',
      width: 1000,
    },
  ],
  position: 0,
  posts: [],
  timing: {},
  ...overrides,
})
const accounts = [
  { channel: 'instagram' as const, id: 'ig', name: 'Instagram' },
  { channel: 'linkedin' as const, id: 'li', name: 'LinkedIn' },
  { channel: 'x' as const, id: 'x', name: 'X' },
]

test('each chosen account is checked apart, with what Shots would change', () => {
  const checks = stagedChecks(item(), accounts)
  assert.deepEqual([...checks.keys()], ['ig', 'li'])
  assert.match(checks.get('ig')!.problems.join(), /4:5 portrait/)
  assert.match(checks.get('ig')!.changes.join(), /JPEG only/)
  assert.deepEqual(checks.get('li')!.problems, [])
  const uploading = item({
    media: [
      { fileName: 'a.png', bytes: 3, durationMs: null, height: null, width: null, status: 'local' },
    ],
  })
  assert.match(stagedChecks(uploading, accounts).get('li')!.problems.join(), /Finish uploading/)
})

test('a local time is read in its own zone, refusing skipped and unchosen repeated times', () => {
  const now = new Date('2026-01-01T00:00:00Z')
  const exact = readTiming(
    { mode: 'time', localTime: '2026-11-03T09:30', timeZone: 'Europe/Paris' },
    now
  )
  assert.equal(exact.kind === 'at' && exact.at.toISOString(), '2026-11-03T08:30:00.000Z')
  assert.match(
    JSON.stringify(
      readTiming({ mode: 'time', localTime: '2026-03-08T02:30', timeZone: 'America/New_York' }, now)
    ),
    /clocks skip it/
  )
  const repeated = {
    mode: 'time' as const,
    localTime: '2026-11-01T01:30',
    timeZone: 'America/New_York',
  }
  assert.match(JSON.stringify(readTiming(repeated, now)), /happens twice/)
  const later = readTiming({ ...repeated, disambiguation: 'later' }, now)
  assert.equal(later.kind === 'at' && later.at.toISOString(), '2026-11-01T06:30:00.000Z')
  assert.equal(readTiming({}, now).kind, 'unset')
  assert.match(JSON.stringify(readTiming({ mode: 'queue' }, now)), /Preview the queue/)
})

test('previewed times become timings that keep the zone or the expected slot', () => {
  assert.deepEqual(spreadTimings(['2026-11-03T08:30:00Z'], 'Europe/Paris'), [
    { mode: 'time', localTime: '2026-11-03T09:30', timeZone: 'Europe/Paris' },
  ])
  assert.deepEqual(queueTimings(['2026-11-03T08:30:00Z']), [
    { mode: 'queue', expectedQueueSlot: '2026-11-03T08:30:00Z' },
  ])
})

test('a corrected item resubmits only accounts without a live post, beside the ones queued', () => {
  const post = (id: string, account: string, status: string, createdAt: string) => ({
    automations: [],
    caption: 'c',
    channelConnectionId: account,
    createdAt,
    id,
    metrics: null,
    metricsAt: null,
    naturalOffsetSeconds: null,
    platform: 'x',
    replies: 0,
    scheduleMode: null,
    scheduleTimeZone: null,
    scheduledFor: createdAt,
    slotAt: null,
    socialSetId: null,
    status,
    threadProgress: { posted: 0, total: 0 },
    url: null,
  })
  const scheduled = item({
    posts: [
      post('1', 'ig', 'SCHEDULED', '2026-01-01T00:00:00Z'),
      post('2', 'li', 'FAILED', '2026-01-01T00:00:00Z'),
      post('3', 'x', 'UNKNOWN_DELIVERY', '2026-01-01T00:00:00Z'),
    ] as BatchItem['posts'],
  })
  assert.deepEqual(pendingAccounts(scheduled, ['ig', 'li', 'x']), { add: true, remaining: ['li'] })
  assert.equal(postOn(scheduled, 'li')?.status, 'FAILED')
  assert.deepEqual(pendingAccounts(item(), ['ig']), { add: false, remaining: ['ig'] })
})
