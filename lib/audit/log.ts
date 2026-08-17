import { Prisma, type AuditLog } from '@prisma/client'
import { prisma } from '@/lib/db'
import { buildAuditSearchText, sanitizeAuditMetadata } from './metadata'
import type { AuditLogInput } from './types'

export type AuditTransaction = Prisma.TransactionClient

function getAuditData(input: AuditLogInput): Prisma.AuditLogUncheckedCreateInput {
  const metadata = sanitizeAuditMetadata(input.metadata)
  return {
    action: input.action,
    actorDisplay: input.actor.display,
    actorType: input.actor.type,
    actorUserId: input.actor.userId,
    entityId: input.entityId,
    entityType: input.entityType,
    ipHash: input.ipHash,
    metadata,
    organizationId: input.organizationId,
    outcome: input.outcome ?? 'SUCCEEDED',
    requestId: input.requestId,
    searchText: buildAuditSearchText([
      input.action,
      input.actor.display,
      input.entityType,
      input.entityId,
    ]),
    userAgentSummary: input.userAgentSummary,
  }
}

async function addDrainDeliveries(
  transaction: AuditTransaction,
  auditLog: AuditLog
): Promise<void> {
  const drains = await transaction.auditDrain.findMany({
    select: { id: true },
    where: { enabled: true, organizationId: auditLog.organizationId },
  })
  if (drains.length === 0) {
    return
  }

  const outbox = await transaction.auditOutbox.create({ data: { auditLogId: auditLog.id } })
  await transaction.auditDrainDelivery.createMany({
    data: drains.map((drain) => ({ drainId: drain.id, outboxId: outbox.id })),
  })
}

export async function appendAuditLog(
  transaction: AuditTransaction,
  input: AuditLogInput
): Promise<AuditLog> {
  const auditLog = await transaction.auditLog.create({ data: getAuditData(input) })
  await addDrainDeliveries(transaction, auditLog)
  return auditLog
}

export async function withAuditTransaction<T>(
  operation: (transaction: AuditTransaction) => Promise<T>,
  audit: AuditLogInput
): Promise<T> {
  return prisma.$transaction(async (transaction) => {
    const result = await operation(transaction)
    await appendAuditLog(transaction, audit)
    return result
  })
}
