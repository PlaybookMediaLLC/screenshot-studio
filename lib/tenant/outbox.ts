import 'server-only'

import { appendAuditLog } from '@/lib/audit/log'
import { getAuditActor, type TriggerServicePrincipal } from '@/lib/auth/principal'
import { prisma } from '@/lib/db'
import { deleteTenantObject } from '@/lib/storage/client'

const maxAttempts = 8
const staleProcessingMilliseconds = 10 * 60 * 1_000

async function requeueStalledEvents(): Promise<void> {
  await prisma.outboxEvent.updateMany({
    data: { processingAt: null },
    where: {
      deadLetteredAt: null,
      deliveredAt: null,
      processingAt: { lt: new Date(Date.now() - staleProcessingMilliseconds) },
    },
  })
}

async function claimOutboxEvent(eventId: string): Promise<boolean> {
  const claimed = await prisma.outboxEvent.updateMany({
    data: { attempts: { increment: 1 }, processingAt: new Date() },
    where: {
      attempts: { lt: maxAttempts },
      deadLetteredAt: null,
      deliveredAt: null,
      id: eventId,
      processingAt: null,
    },
  })
  return claimed.count === 1
}

async function isDispatchable(event: {
  aggregateId: string
  aggregateType: string
  organizationId: string
  type: string
}): Promise<boolean> {
  if (event.aggregateType === 'asset' && event.type === 'asset.uploaded') {
    return Boolean(
      await prisma.asset.findFirst({
        select: { id: true },
        where: { id: event.aggregateId, organizationId: event.organizationId, status: 'UPLOADED' },
      })
    )
  }
  if (event.aggregateType === 'release') {
    return Boolean(
      await prisma.release.findFirst({
        select: { id: true },
        where: {
          id: event.aggregateId,
          organizationId: event.organizationId,
          status: { not: 'CANCELLED' },
        },
      })
    )
  }

  return false
}

async function deleteAssetObject(event: {
  aggregateId: string
  organizationId: string
}): Promise<void> {
  const asset = await prisma.asset.findFirst({
    select: { objectKey: true },
    where: {
      id: event.aggregateId,
      organizationId: event.organizationId,
      status: 'DELETED',
    },
  })
  if (!asset) {
    throw new Error('The deleted asset was not found.')
  }
  await deleteTenantObject({ objectKey: asset.objectKey, organizationId: event.organizationId })
}

async function completeEvent(event: {
  id: string
  organizationId: string
  type: string
}): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    const completed = await transaction.outboxEvent.updateMany({
      data: { deliveredAt: new Date(), lastError: null, processingAt: null },
      where: { deliveredAt: null, id: event.id },
    })
    if (completed.count === 0) {
      return
    }

    const principal: TriggerServicePrincipal = {
      kind: 'trigger_service',
      organizationId: event.organizationId,
      taskRunId: event.id,
    }
    await appendAuditLog(transaction, {
      action: 'product.outbox_dispatched',
      actor: getAuditActor(principal),
      entityId: event.id,
      entityType: 'outbox_event',
      organizationId: event.organizationId,
      requestId: event.id,
    })
  })
}

async function failEvent(
  event: { attempts: number; id: string; organizationId: string },
  error: unknown
): Promise<void> {
  const lastError = error instanceof Error ? error.message.slice(0, 500) : 'Outbox event failed.'
  const deadLettered = event.attempts >= maxAttempts

  await prisma.$transaction(async (transaction) => {
    const failed = await transaction.outboxEvent.updateMany({
      data: { deadLetteredAt: deadLettered ? new Date() : null, lastError, processingAt: null },
      where: { deadLetteredAt: null, deliveredAt: null, id: event.id },
    })
    if (!deadLettered || failed.count === 0) {
      return
    }
    const principal: TriggerServicePrincipal = {
      kind: 'trigger_service',
      organizationId: event.organizationId,
      taskRunId: event.id,
    }
    await appendAuditLog(transaction, {
      action: 'product.outbox_dead_lettered',
      actor: getAuditActor(principal),
      entityId: event.id,
      entityType: 'outbox_event',
      metadata: { attempts: event.attempts, lastError },
      organizationId: event.organizationId,
      outcome: 'FAILED',
      requestId: event.id,
    })
  })
}

async function dispatchClaimedEvent(eventId: string): Promise<void> {
  const event = await prisma.outboxEvent.findFirst({
    select: {
      aggregateId: true,
      aggregateType: true,
      attempts: true,
      id: true,
      organizationId: true,
      type: true,
    },
    where: { deadLetteredAt: null, deliveredAt: null, id: eventId },
  })
  if (!event) {
    return
  }

  try {
    if (event.aggregateType === 'asset' && event.type === 'asset.deleted') {
      await deleteAssetObject(event)
    } else if (!(await isDispatchable(event))) {
      throw new Error('Tenant resource is no longer eligible for dispatch.')
    }

    await completeEvent(event)
  } catch (error) {
    await failEvent(event, error)
  }
}

export async function replayDeadLetteredOutboxEvent(eventId: string): Promise<boolean> {
  const replayed = await prisma.outboxEvent.updateMany({
    data: { attempts: 0, deadLetteredAt: null, lastError: null, processingAt: null },
    where: { deadLetteredAt: { not: null }, deliveredAt: null, id: eventId },
  })
  if (replayed.count === 0) {
    return false
  }

  const event = await prisma.outboxEvent.findUniqueOrThrow({
    select: { id: true, organizationId: true },
    where: { id: eventId },
  })
  const principal: TriggerServicePrincipal = {
    kind: 'trigger_service',
    organizationId: event.organizationId,
    taskRunId: event.id,
  }
  await appendAuditLog(prisma, {
    action: 'product.outbox_replayed',
    actor: getAuditActor(principal),
    entityId: event.id,
    entityType: 'outbox_event',
    organizationId: event.organizationId,
    requestId: event.id,
  })
  return true
}

export async function dispatchPendingTenantOutboxEvents(): Promise<number> {
  await requeueStalledEvents()
  const events = await prisma.outboxEvent.findMany({
    orderBy: { createdAt: 'asc' },
    select: { id: true },
    take: 100,
    where: {
      attempts: { lt: maxAttempts },
      deadLetteredAt: null,
      deliveredAt: null,
      processingAt: null,
    },
  })
  for (const event of events) {
    if (await claimOutboxEvent(event.id)) {
      await dispatchClaimedEvent(event.id)
    }
  }

  return events.length
}
