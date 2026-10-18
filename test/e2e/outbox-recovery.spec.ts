import { z } from 'zod'
import { signUpAndCreateWorkspace } from './framework/auth'
import { requestJson } from './framework/browser'
import { configureE2EFlow, expect, test } from './framework/flow'
import { getMaintenanceHeaders } from './framework/maintenance'
import { createE2EDatabase, queryRow } from './framework/services'

const releaseSchema = z.object({
  created: z.boolean(),
  release: z.object({ id: z.string().min(1) }),
})

configureE2EFlow()

// Dispatch, retries, and dead-lettering run in the Go maintenance worker and
// are covered by services/internal/maintenance. This flow covers the operator
// replay endpoint that returns a dead-lettered event to the queue.
test('a dead-lettered outbox event is replayed once and audited', async ({ identity, page }) => {
  await signUpAndCreateWorkspace(identity, page)
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
  const database = createE2EDatabase()

  try {
    const event = await queryRow<{ id: string }>(
      database,
      `SELECT id FROM outbox_event WHERE "aggregateId" = $1 AND type = 'release.created' LIMIT 1`,
      [created.release.id]
    )
    if (!event) throw new Error('The release outbox event was not created.')
    await database.query(
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
    expect(
      await queryRow(database, 'SELECT * FROM outbox_event WHERE id = $1', [event.id])
    ).toMatchObject({
      attempts: 0,
      deadLetteredAt: null,
      deliveredAt: null,
      lastError: null,
      processingAt: null,
    })
    expect(
      await queryRow(
        database,
        `SELECT id FROM audit_log WHERE action = 'product.outbox_replayed' AND "entityId" = $1`,
        [event.id]
      )
    ).not.toBeNull()
    expect((await replay()).status).toBe(404)
  } finally {
    await database.end()
  }
})
