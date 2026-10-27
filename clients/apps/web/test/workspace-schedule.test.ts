import assert from 'node:assert/strict'
import test from 'node:test'
import { getNextWorkspacePublishTime } from '@/lib/workspace/schedule'

test('workspace schedule default resolves the next local publishing time', () => {
  const next = getNextWorkspacePublishTime({
    now: new Date('2026-08-20T15:00:00.000Z'),
    time: '09:30',
    timeZone: 'America/New_York',
  })
  assert.equal(next.toISOString(), '2026-08-21T13:30:00.000Z')
})

test('workspace schedule default uses today when the local time is still ahead', () => {
  const next = getNextWorkspacePublishTime({
    now: new Date('2026-08-20T12:00:00.000Z'),
    time: '09:30',
    timeZone: 'America/New_York',
  })
  assert.equal(next.toISOString(), '2026-08-20T13:30:00.000Z')
})
