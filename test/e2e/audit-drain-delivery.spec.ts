import { z } from 'zod'
import {
  enableTwoFactor,
  getActiveOrganizationId,
  signUpAndCreateWorkspace,
} from './framework/auth'
import { browserRequest, requestJson } from './framework/browser'
import { configureE2EFlow, expect, test } from './framework/flow'
import { createE2EDatabase, queryRow } from './framework/services'

const drainSchema = z.object({ drain: z.object({ id: z.string() }) })
const retentionAction = 'audit.retention_changed'
const signingSecret = 'e2e-audit-drain-signing-secret'

configureE2EFlow()

// Signed delivery, retries, and the retry ceiling run in the Go maintenance
// worker (services/internal/maintenance). This flow covers what the product
// path owns: a sealed secret, one queued delivery per audited change, removal.
test('an audit drain seals its secret, queues audited changes, and can be removed', async ({
  identity,
  page,
}) => {
  const database = createE2EDatabase()

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
          signingSecret,
        })
      ).body
    ).drain
    const stored = await queryRow<{ encryptedSigningSecret: string }>(
      database,
      'SELECT "encryptedSigningSecret" FROM audit_drain WHERE id = $1',
      [drain.id]
    )
    if (!stored) throw new Error('The audit drain was not stored.')
    expect(stored.encryptedSigningSecret).not.toContain(signingSecret)
    expect(stored.encryptedSigningSecret.split('.')).toHaveLength(3)

    expect(
      (
        await requestJson(
          page,
          '/api/enterprise/audit-retention',
          { legalHold: false, organizationId, retentionDays: 91 },
          'PUT'
        )
      ).body
    ).toEqual({ legalHold: false, retentionDays: 91 })
    expect(
      await queryRow(
        database,
        `SELECT delivery.* FROM audit_drain_delivery delivery
         JOIN audit_outbox outbox ON outbox.id = delivery."outboxId"
         JOIN audit_log log ON log.id = outbox."auditLogId"
         WHERE delivery."drainId" = $1 AND log.action = $2 LIMIT 1`,
        [drain.id, retentionAction]
      )
    ).toMatchObject({ attemptCount: 0, deliveredAt: null, status: 'PENDING' })

    const query = new URLSearchParams({ organizationId })
    expect(
      (
        await browserRequest(page, `/api/enterprise/audit-drains/${drain.id}?${query}`, {
          method: 'DELETE',
        })
      ).status
    ).toBe(204)
    expect(
      await queryRow(
        database,
        'SELECT count(*)::int AS count FROM audit_drain_delivery WHERE "drainId" = $1',
        [drain.id]
      )
    ).toEqual({ count: 0 })
    expect(
      await queryRow(
        database,
        `SELECT count(*)::int AS count FROM audit_log
         WHERE action IN ('audit.drain_created', 'audit.drain_deleted') AND "entityId" = $1`,
        [drain.id]
      )
    ).toEqual({ count: 2 })
  } finally {
    await database.end()
  }
})
