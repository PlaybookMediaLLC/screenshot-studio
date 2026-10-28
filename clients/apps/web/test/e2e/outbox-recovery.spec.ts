import { z } from 'zod'
import { db, expect, getMaintenanceHeaders, requestJson, test } from './framework'

test.use({ workspaceOptions: { plan: 'pro' } })

const releaseSchema = z.object({
  created: z.boolean(),
  release: z.object({ id: z.string().min(1) }),
})

// Dispatch, retries, and dead-lettering run in the Go maintenance worker and
// are covered by server/internal/maintenance. This flow covers the operator
// replay endpoint that returns a dead-lettered event to the queue.
test('a dead-lettered outbox event is replayed once and audited', async ({ page }) => {
  const created = releaseSchema.parse(
    (
      await requestJson(
        page,
        '/api/tenant/releases',
        { benefitStatement: 'Recover poison outbox events safely.', title: 'Poisoned release' },
        'POST',
        { 'idempotency-key': 'e2e-outbox-poison' }
      )
    ).body
  )
  const event = await db.row<{ id: string }>(
    `SELECT id FROM outbox_event WHERE "aggregateId" = $1 AND type = 'release.created' LIMIT 1`,
    [created.release.id]
  )
  if (!event) throw new Error('The release outbox event was not created.')
  await db.query(
    `UPDATE outbox_event
       SET attempts = 8, "deadLetteredAt" = now(), "lastError" = 'DISPATCH_FAILED'
       WHERE id = $1`,
    [event.id]
  )

  const replay = () =>
    requestJson(
      page,
      `/api/internal/tenant-outbox/${event.id}/replay`,
      {},
      'POST',
      getMaintenanceHeaders()
    )
  expect(await replay()).toMatchObject({ body: { replayed: true }, status: 200 })
  expect(await db.row('SELECT * FROM outbox_event WHERE id = $1', [event.id])).toMatchObject({
    attempts: 0,
    deadLetteredAt: null,
    deliveredAt: null,
    lastError: null,
    processingAt: null,
  })
  expect(
    await db.row(
      `SELECT id FROM audit_log WHERE action = 'product.outbox_replayed' AND "entityId" = $1`,
      [event.id]
    )
  ).not.toBeNull()
  expect((await replay()).status).toBe(404)
})
