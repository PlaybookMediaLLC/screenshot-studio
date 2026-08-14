import 'server-only'

import { assertAuditRetentionDatabase, auditRetentionPrisma } from './retention-db'
import { appendAuditLog } from './log'

export const defaultAuditRetentionDays = 90

function getCutoff(retentionDays: number): Date {
  return new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1_000)
}

async function purgeOrganizationAuditLogs(
  organizationId: string,
  retentionDays: number
): Promise<number> {
  const result = await auditRetentionPrisma.auditLog.deleteMany({
    where: { createdAt: { lt: getCutoff(retentionDays) }, organizationId },
  })
  return result.count
}

async function recordAuditPurge(
  organizationId: string,
  deletedCount: number,
  retentionDays: number
): Promise<void> {
  await auditRetentionPrisma.$transaction((transaction) =>
    appendAuditLog(transaction, {
      action: 'product.audit_retention_purged',
      actor: { display: 'audit-retention', type: 'SERVICE' },
      entityType: 'audit_log',
      metadata: { deletedCount, retentionDays },
      organizationId,
      requestId: `audit-retention-${new Date().toISOString().slice(0, 10)}`,
    })
  )
}

export async function purgeExpiredAuditLogs(): Promise<number> {
  assertAuditRetentionDatabase()
  const organizations = await auditRetentionPrisma.organization.findMany({
    include: { retentionPolicy: true },
  })
  let deletedCount = 0
  for (const organization of organizations) {
    if (organization.retentionPolicy?.legalHold) {
      continue
    }
    const retentionDays = organization.retentionPolicy?.retentionDays ?? defaultAuditRetentionDays
    const count = await purgeOrganizationAuditLogs(organization.id, retentionDays)
    if (count > 0) {
      await recordAuditPurge(organization.id, count, retentionDays)
      deletedCount += count
    }
  }

  return deletedCount
}
