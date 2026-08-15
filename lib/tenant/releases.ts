import 'server-only'

import { randomUUID } from 'node:crypto'
import { type Prisma } from '@prisma/client'
import { appendAuditLog } from '@/lib/audit/log'
import type { TenantContext } from '@/lib/auth/access'
import { getAuditActor } from '@/lib/auth/principal'
import { prisma } from '@/lib/db'
import type { ReleaseCreateInput } from './schemas'

type CreateReleaseInput = ReleaseCreateInput & { idempotencyKey: string }

type ReleaseResult = {
  created: boolean
  release: { id: string; status: string; title: string }
}

const releaseSelect = { id: true, status: true, title: true } as const

async function getIdempotentRelease(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  idempotencyKey: string
): Promise<ReleaseResult | null> {
  const event = await transaction.outboxEvent.findUnique({
    where: { organizationId_idempotencyKey: { idempotencyKey, organizationId } },
  })
  if (!event || event.aggregateType !== 'release') {
    return null
  }

  const release = await transaction.release.findFirst({
    select: releaseSelect,
    where: { id: event.aggregateId, organizationId },
  })
  return release ? { created: false, release } : null
}

async function createReleaseOutbox(
  transaction: Prisma.TransactionClient,
  context: TenantContext,
  input: CreateReleaseInput,
  releaseId: string
): Promise<void> {
  await transaction.outboxEvent.create({
    data: {
      aggregateId: releaseId,
      aggregateType: 'release',
      idempotencyKey: input.idempotencyKey,
      organizationId: context.organizationId,
      payload: { releaseId },
      type: 'release.created',
    },
  })
}

async function createReleaseRecord(
  transaction: Prisma.TransactionClient,
  context: TenantContext,
  input: CreateReleaseInput,
  releaseId: string
) {
  return transaction.release.create({
    data: {
      benefitStatement: input.benefitStatement,
      createdByUserId: context.principal.kind === 'session' ? context.principal.userId : undefined,
      id: releaseId,
      organizationId: context.organizationId,
      title: input.title,
    },
    select: releaseSelect,
  })
}

async function auditReleaseCreation(
  transaction: Prisma.TransactionClient,
  context: TenantContext,
  releaseId: string
): Promise<void> {
  await appendAuditLog(transaction, {
    action: 'product.release_created',
    actor: getAuditActor(context.principal),
    entityId: releaseId,
    entityType: 'release',
    organizationId: context.organizationId,
    requestId: context.requestId,
  })
}

async function createReleaseInTransaction(
  transaction: Prisma.TransactionClient,
  context: TenantContext,
  input: CreateReleaseInput,
  releaseId: string
): Promise<ReleaseResult> {
  const existing = await getIdempotentRelease(
    transaction,
    context.organizationId,
    input.idempotencyKey
  )
  if (existing) {
    return existing
  }

  await createReleaseOutbox(transaction, context, input, releaseId)
  const release = await createReleaseRecord(transaction, context, input, releaseId)
  await auditReleaseCreation(transaction, context, release.id)
  return { created: true, release }
}

export async function createRelease(
  context: TenantContext,
  input: CreateReleaseInput
): Promise<ReleaseResult> {
  return prisma.$transaction((transaction) =>
    createReleaseInTransaction(transaction, context, input, randomUUID())
  )
}

export async function listReleases(organizationId: string, take: number) {
  return prisma.release.findMany({
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    select: {
      benefitStatement: true,
      createdAt: true,
      id: true,
      status: true,
      title: true,
      updatedAt: true,
    },
    take,
    where: { organizationId },
  })
}
