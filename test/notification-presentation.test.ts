import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { groupNotifications, notificationTitle } from '../lib/notifications/presentation'
import { notificationItemSchema } from '../lib/notifications/schema'

const item = (id: string, createdAt: string, entityId = 'workflow') =>
  notificationItemSchema.parse({
    id,
    kind: 'workflow.needs_attention',
    description: 'Workflow run needs attention',
    href: '/workflows/runs/one',
    createdAt,
    workspaceId: 'workspace',
    workspaceName: 'Workspace',
    context: {
      entityType: 'workflow',
      entityId,
      name: entityId === 'other' ? 'Other launch' : 'Product launch',
      source: 'workflows',
      status: 'failed',
    },
  })
test('groups by calendar day and collapses only repeated events for the same object', () => {
  const now = new Date(2026, 9, 21, 12)
  const today = new Date(2026, 9, 21, 10).toISOString()
  const yesterday = new Date(2026, 9, 20, 23).toISOString()
  const groups = groupNotifications(
    [
      item('a', today),
      item('b', today),
      item('c', today),
      item('d', today, 'other'),
      item('e', yesterday),
    ],
    now
  )
  assert.deepEqual(
    groups.map((group) => group.label),
    ['Today', 'Yesterday']
  )
  assert.deepEqual(
    groups[0].batches.map((batch) => batch.items.length),
    [3, 1]
  )
  assert.equal(
    notificationTitle(groups[0].batches[0].items[0]),
    'Workflow run needs attention — Product launch'
  )
})
test('older payloads render without invented details or seen state', () => {
  const { context: _, seenAt: __, ...old } = item('old', '2026-10-01T12:00:00Z')
  const parsed = notificationItemSchema.parse(old)
  assert.equal(parsed.seenAt, null)
  assert.equal(notificationTitle(parsed), parsed.description)
})
