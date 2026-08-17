import { z } from 'zod'
import { signUpAndCreateWorkspace } from './framework/auth'
import { requestJson } from './framework/browser'
import { configureE2EFlow, expect, test } from './framework/flow'
import { getMaintenanceHeaders } from './framework/maintenance'
import { createE2EDatabaseClient } from './framework/services'

const releaseSchema = z.object({
  created: z.boolean(),
  release: z.object({ id: z.string().uuid() }),
})

configureE2EFlow()

test('an outbox event remains retryable after a blocked release and dispatches once after recovery', async ({
  identity,
  page,
}) => {
  await signUpAndCreateWorkspace(identity, page)
  const created = releaseSchema.parse(
    (
      await requestJson(
        page,
        '/api/tenant/releases',
        { benefitStatement: 'Reliable retries for release content.', title: 'Retryable release' },
        'POST',
        { 'idempotency-key': 'e2e-outbox-recovery' }
      )
    ).body
  )
  const database = createE2EDatabaseClient()

  try {
    await database.release.update({
      data: { status: 'CANCELLED' },
      where: { id: created.release.id },
    })
    expect(
      (
        await requestJson(
          page,
          '/api/internal/tenant-outbox/dispatch',
          {},
          'POST',
          getMaintenanceHeaders()
        )
      ).status
    ).toBe(200)
    const failed = await database.outboxEvent.findFirstOrThrow({
      where: { aggregateId: created.release.id, type: 'release.created' },
    })
    expect(failed).toMatchObject({ attempts: 1, deliveredAt: null, lastError: expect.any(String) })

    await database.release.update({ data: { status: 'DRAFT' }, where: { id: created.release.id } })
    expect(
      (
        await requestJson(
          page,
          '/api/internal/tenant-outbox/dispatch',
          {},
          'POST',
          getMaintenanceHeaders()
        )
      ).status
    ).toBe(200)
    const delivered = await database.outboxEvent.findUniqueOrThrow({ where: { id: failed.id } })
    expect(delivered).toMatchObject({ attempts: 2, lastError: null })
    expect(delivered.deliveredAt).toBeInstanceOf(Date)
  } finally {
    await database.$disconnect()
  }
})

test('a poison outbox event is dead-lettered, audited, replayed, and dispatched once', async ({
  identity,
  page,
}) => {
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
  const database = createE2EDatabaseClient()

  try {
    const event = await database.outboxEvent.findFirstOrThrow({
      where: { aggregateId: created.release.id, type: 'release.created' },
    })
    await database.release.update({
      data: { status: 'CANCELLED' },
      where: { id: created.release.id },
    })
    await database.outboxEvent.update({ data: { attempts: 7 }, where: { id: event.id } })

    const deadLetter = await requestJson(
      page,
      '/api/internal/tenant-outbox/dispatch',
      {},
      'POST',
      getMaintenanceHeaders()
    )
    expect(deadLetter.status).toBe(200)
    expect(
      z.object({ dispatched: z.number().positive() }).parse(deadLetter.body).dispatched
    ).toBeGreaterThan(0)
    expect(await database.outboxEvent.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject(
      {
        attempts: 8,
        deadLetteredAt: expect.any(Date),
        deliveredAt: null,
      }
    )
    expect(
      await database.auditLog.findFirst({
        where: { action: 'product.outbox_dead_lettered', entityId: event.id },
      })
    ).not.toBeNull()

    await database.release.update({ data: { status: 'DRAFT' }, where: { id: created.release.id } })
    const replayed = await requestJson(
      page,
      `/api/internal/tenant-outbox/${event.id}/replay`,
      {},
      'POST',
      getMaintenanceHeaders()
    )
    expect(replayed).toMatchObject({ body: { replayed: true }, status: 200 })
    const dispatched = await requestJson(
      page,
      '/api/internal/tenant-outbox/dispatch',
      {},
      'POST',
      getMaintenanceHeaders()
    )
    expect(dispatched.status).toBe(200)
    expect(
      z.object({ dispatched: z.number().positive() }).parse(dispatched.body).dispatched
    ).toBeGreaterThan(0)
    expect(await database.outboxEvent.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject(
      {
        attempts: 1,
        deadLetteredAt: null,
        deliveredAt: expect.any(Date),
      }
    )
    expect(
      await database.auditLog.findFirst({
        where: { action: 'product.outbox_replayed', entityId: event.id },
      })
    ).not.toBeNull()
  } finally {
    await database.$disconnect()
  }
})
