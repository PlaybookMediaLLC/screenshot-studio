import 'server-only'

import { randomUUID } from 'node:crypto'
import { type Prisma } from '@prisma/client'
import { appendAuditLog } from '@/lib/audit/log'
import type { TenantContext } from '@/lib/auth/access'
import { getAuditActor } from '@/lib/auth/principal'
import { prisma } from '@/lib/db'
import type { ReleaseCreateInput, ReleaseUpdateInput } from './schemas'

type CreateReleaseInput = ReleaseCreateInput & { idempotencyKey: string }

type ReleaseResult = {
  created: boolean
  release: { id: string; productSurfaceId: string | null; status: string; title: string }
}

const releaseSelect = { id: true, productSurfaceId: true, status: true, title: true } as const

const releaseDetailSelect = {
  audience: true,
  benefitStatement: true,
  createdAt: true,
  description: true,
  id: true,
  productSurface: { select: { environment: true, id: true, name: true, url: true } },
  productSurfaceId: true,
  sourceUrls: true,
  status: true,
  title: true,
  updatedAt: true,
} as const

export class ReleaseError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404
  ) {
    super(message)
    this.name = 'ReleaseError'
  }
}

/**
 * Reject a surface id that does not belong to the caller's workspace. The
 * foreign key alone would accept another tenant's surface, so ownership is
 * checked here on every write that links one.
 */
export async function requireWorkspaceProductSurface(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  productSurfaceId: string | null | undefined
): Promise<void> {
  if (!productSurfaceId) return
  const surface = await transaction.productSurface.findFirst({
    select: { id: true },
    where: { id: productSurfaceId, organizationId },
  })
  if (!surface) {
    throw new ReleaseError('Product surface not found.', 404)
  }
}

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
      audience: input.audience || null,
      benefitStatement: input.benefitStatement,
      createdByUserId: context.principal.kind === 'session' ? context.principal.userId : undefined,
      description: input.description || null,
      id: releaseId,
      organizationId: context.organizationId,
      productSurfaceId: input.productSurfaceId ?? null,
      sourceUrls: input.sourceUrls ?? [],
      title: input.title,
    },
    select: releaseSelect,
  })
}

async function auditReleaseCreation(
  transaction: Prisma.TransactionClient,
  context: TenantContext,
  release: ReleaseResult['release']
): Promise<void> {
  await appendAuditLog(transaction, {
    action: 'product.release_created',
    actor: getAuditActor(context.principal),
    entityId: release.id,
    entityType: 'release',
    metadata: { productSurfaceId: release.productSurfaceId },
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

  await requireWorkspaceProductSurface(transaction, context.organizationId, input.productSurfaceId)
  await createReleaseOutbox(transaction, context, input, releaseId)
  const release = await createReleaseRecord(transaction, context, input, releaseId)
  await auditReleaseCreation(transaction, context, release)
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
      productSurfaceId: true,
      status: true,
      title: true,
      updatedAt: true,
    },
    take,
    where: { organizationId },
  })
}

export async function getRelease(organizationId: string, releaseId: string) {
  return prisma.release.findFirst({
    select: releaseDetailSelect,
    where: { id: releaseId, organizationId },
  })
}

/**
 * Edit a release brief. Only the brief's own columns change: campaigns,
 * angles, posts, and creative variants that reference the release keep
 * their content, so later generation can be re-run without losing work.
 */
export async function updateRelease(
  context: TenantContext,
  releaseId: string,
  input: ReleaseUpdateInput
) {
  return prisma.$transaction(async (transaction) => {
    const existing = await transaction.release.findFirst({
      select: { id: true },
      where: { id: releaseId, organizationId: context.organizationId },
    })
    if (!existing) {
      throw new ReleaseError('Release not found.', 404)
    }
    await requireWorkspaceProductSurface(
      transaction,
      context.organizationId,
      input.productSurfaceId
    )
    const release = await transaction.release.update({
      data: {
        ...(input.audience !== undefined && { audience: input.audience || null }),
        ...(input.benefitStatement !== undefined && { benefitStatement: input.benefitStatement }),
        ...(input.description !== undefined && { description: input.description || null }),
        ...(input.productSurfaceId !== undefined && { productSurfaceId: input.productSurfaceId }),
        ...(input.sourceUrls !== undefined && { sourceUrls: input.sourceUrls }),
        ...(input.title !== undefined && { title: input.title }),
      },
      select: releaseDetailSelect,
      where: { id: releaseId },
    })
    await appendAuditLog(transaction, {
      action: 'product.release_updated',
      actor: getAuditActor(context.principal),
      entityId: releaseId,
      entityType: 'release',
      metadata: { fields: Object.keys(input).sort().join(',') },
      organizationId: context.organizationId,
      requestId: context.requestId,
    })
    return release
  })
}
