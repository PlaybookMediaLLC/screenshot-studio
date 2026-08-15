import { createHmac } from 'node:crypto'
import { z } from 'zod'
import {
  enableTwoFactor,
  getActiveOrganizationId,
  signUpAndCreateWorkspace,
} from './framework/auth'
import { requestJson } from './framework/browser'
import { startHttpMockServer, type HttpMockRequest } from './framework/http-server'
import { configureE2EFlow, expect, test } from './framework/flow'
import { getMaintenanceHeaders } from './framework/maintenance'
import { createE2EDatabaseClient } from './framework/services'

const drainSchema = z.object({ drain: z.object({ id: z.string() }) })
const auditEventSchema = z.object({ data: z.object({ action: z.string() }) })
const retentionAction = 'audit.retention_changed'

function getSigningSecret(): string {
  return 'e2e-audit-drain-signing-secret'
}

function isRetentionEvent(request: HttpMockRequest): boolean {
  return auditEventSchema.safeParse(JSON.parse(request.body)).data?.data.action === retentionAction
}

configureE2EFlow()

test('an audit drain signs its event, retries a failure, and records delivery', async ({
  identity,
  page,
}) => {
  let retentionAttempts = 0
  const downstream = await startHttpMockServer(async (request) => {
    if (!isRetentionEvent(request)) {
      return { status: 202 }
    }

    retentionAttempts += 1
    return { status: retentionAttempts === 1 ? 503 : 202 }
  })
  const database = createE2EDatabaseClient()

  try {
    await signUpAndCreateWorkspace(identity, page)
    const organizationId = await getActiveOrganizationId(page)
    await enableTwoFactor(page, identity.password)
    const drain = drainSchema.parse(
      (
        await requestJson(page, '/api/enterprise/audit-drains', {
          endpoint: 'https://audit.example/events',
          name: 'E2E delivery drain',
          organizationId,
          provider: 'GENERIC',
          signingSecret: getSigningSecret(),
        })
      ).body
    ).drain
    await database.auditDrain.update({
      data: { endpoint: downstream.containerUrl },
      where: { id: drain.id },
    })
    expect(
      (
        await requestJson(
          page,
          '/api/enterprise/audit-retention',
          { legalHold: false, organizationId, retentionDays: 91 },
          'PUT'
        )
      ).status
    ).toBe(200)

    expect(
      (await requestJson(page, '/api/internal/audit-drains/dispatch', {}, 'POST', getMaintenanceHeaders()))
        .status
    ).toBe(200)
    const firstDelivery = await database.auditDrainDelivery.findFirstOrThrow({
      where: { drainId: drain.id, outbox: { auditLog: { action: retentionAction } } },
    })
    expect(firstDelivery).toMatchObject({ attemptCount: 1, deliveredAt: null, status: 'PENDING' })
    expect(firstDelivery.lastError).toContain('503')
    const retentionCalls = downstream.calls.filter(isRetentionEvent)
    expect(retentionCalls).toHaveLength(1)
    expect(retentionCalls[0]).toMatchObject({ method: 'POST' })
    expect(retentionCalls[0]?.headers['x-screenshot-studio-signature']).toBe(
      createHmac('sha256', getSigningSecret())
        .update(retentionCalls[0]?.body ?? '')
        .digest('hex')
    )

    await database.auditDrainDelivery.update({
      data: { nextAttemptAt: new Date(0) },
      where: { id: firstDelivery.id },
    })
    expect(
      (await requestJson(page, '/api/internal/audit-drains/dispatch', {}, 'POST', getMaintenanceHeaders()))
        .status
    ).toBe(200)
    const delivered = await database.auditDrainDelivery.findUniqueOrThrow({
      where: { id: firstDelivery.id },
    })
    expect(delivered).toMatchObject({ attemptCount: 2, responseCode: 202, status: 'DELIVERED' })
    expect(delivered.deliveredAt).toBeInstanceOf(Date)
    expect(downstream.calls.filter(isRetentionEvent)).toHaveLength(2)
  } finally {
    await database.$disconnect()
    await downstream.close()
  }
})
