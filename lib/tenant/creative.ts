import 'server-only'

import { Prisma } from '@prisma/client'
import { appendAuditLog } from '@/lib/audit/log'
import type { TenantContext } from '@/lib/auth/access'
import { getAuditActor } from '@/lib/auth/principal'
import { prisma } from '@/lib/db'
import type {
  CreativeTemplateCreateInput,
  CreativeVariantApprovalInput,
  CreativeVariantCreateInput,
} from './schemas'

const templateSelect = {
  createdAt: true,
  definition: true,
  id: true,
  name: true,
  status: true,
  version: true,
} as const

const variantSelect = {
  aspectRatio: true,
  brandKitId: true,
  brandKitVersion: true,
  id: true,
  releaseId: true,
  revision: true,
  sourceAssetId: true,
  status: true,
  templateId: true,
  templateVersion: true,
} as const

export class CreativeWorkflowError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409
  ) {
    super(message)
    this.name = 'CreativeWorkflowError'
  }
}

function getCreatorId(context: TenantContext): string {
  if (context.principal.kind === 'session') return context.principal.userId
  throw new CreativeWorkflowError('A signed-in creator is required.', 400)
}

export async function createCreativeTemplate(
  context: TenantContext,
  input: CreativeTemplateCreateInput
) {
  return prisma.$transaction(async (transaction) => {
    const current = await transaction.creativeTemplate.findFirst({
      orderBy: { version: 'desc' },
      select: { version: true },
      where: { name: input.name, organizationId: context.organizationId },
    })
    const template = await transaction.creativeTemplate.create({
      data: {
        definition: input.definition,
        name: input.name,
        organizationId: context.organizationId,
        status: 'ACTIVE',
        version: (current?.version ?? 0) + 1,
      },
      select: templateSelect,
    })
    await appendAuditLog(transaction, {
      action: 'product.creative_template_created',
      actor: getAuditActor(context.principal),
      entityId: template.id,
      entityType: 'creative_template',
      organizationId: context.organizationId,
      requestId: context.requestId,
    })
    return template
  })
}

async function findVariantResources(
  transaction: Prisma.TransactionClient,
  context: TenantContext,
  input: CreativeVariantCreateInput
) {
  const [asset, brandKit, release, template] = await Promise.all([
    transaction.asset.findFirst({
      select: { id: true },
      where: {
        id: input.sourceAssetId,
        organizationId: context.organizationId,
        status: 'UPLOADED',
      },
    }),
    transaction.brandKit.findFirst({
      select: { id: true, version: true },
      where: { id: input.brandKitId, organizationId: context.organizationId, status: 'ACTIVE' },
    }),
    transaction.release.findFirst({
      select: { id: true },
      where: { id: input.releaseId, organizationId: context.organizationId },
    }),
    transaction.creativeTemplate.findFirst({
      select: { id: true, version: true },
      where: { id: input.templateId, organizationId: context.organizationId, status: 'ACTIVE' },
    }),
  ])
  if (!asset || !brandKit || !release || !template) {
    throw new CreativeWorkflowError('The creative source or configuration was not found.', 404)
  }
  return { brandKit, template }
}

async function nextVariantRevision(
  transaction: Prisma.TransactionClient,
  context: TenantContext,
  input: CreativeVariantCreateInput
): Promise<number> {
  const current = await transaction.creativeVariant.findFirst({
    orderBy: { revision: 'desc' },
    select: { revision: true },
    where: { aspectRatio: input.aspectRatio, releaseId: input.releaseId },
  })
  return (current?.revision ?? 0) + 1
}

export async function createCreativeVariant(
  context: TenantContext,
  input: CreativeVariantCreateInput
) {
  const creatorId = getCreatorId(context)
  try {
    return await prisma.$transaction(async (transaction) => {
      const [resources, revision] = await Promise.all([
        findVariantResources(transaction, context, input),
        nextVariantRevision(transaction, context, input),
      ])
      const variant = await transaction.creativeVariant.create({
        data: {
          aspectRatio: input.aspectRatio,
          brandKitId: resources.brandKit.id,
          brandKitVersion: resources.brandKit.version,
          createdByUserId: creatorId,
          organizationId: context.organizationId,
          releaseId: input.releaseId,
          revision,
          sourceAssetId: input.sourceAssetId,
          templateId: resources.template.id,
          templateVersion: resources.template.version,
        },
        select: variantSelect,
      })
      await transaction.approval.create({
        data: { organizationId: context.organizationId, variantId: variant.id },
      })
      await appendAuditLog(transaction, {
        action: 'product.creative_variant_created',
        actor: getAuditActor(context.principal),
        entityId: variant.id,
        entityType: 'creative_variant',
        organizationId: context.organizationId,
        requestId: context.requestId,
      })
      return variant
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new CreativeWorkflowError(
        'A creative revision was created concurrently. Try again.',
        409
      )
    }
    throw error
  }
}

export async function decideCreativeVariantApproval(
  context: TenantContext,
  variantId: string,
  input: CreativeVariantApprovalInput
) {
  return prisma.$transaction(async (transaction) => {
    const variant = await transaction.creativeVariant.findFirst({
      select: { id: true, status: true },
      where: { id: variantId, organizationId: context.organizationId },
    })
    if (!variant || variant.status === 'ARCHIVED') {
      throw new CreativeWorkflowError('The creative variant was not found.', 404)
    }
    const approval = await transaction.approval.upsert({
      create: {
        decidedAt: new Date(),
        decidedByUserId: getCreatorId(context),
        organizationId: context.organizationId,
        reason: input.reason,
        status: input.status,
        variantId,
      },
      update: {
        decidedAt: new Date(),
        decidedByUserId: getCreatorId(context),
        reason: input.reason,
        status: input.status,
      },
      where: { variantId },
    })
    const updated = await transaction.creativeVariant.update({
      data: { status: input.status === 'APPROVED' ? 'APPROVED' : 'DRAFT' },
      select: variantSelect,
      where: { id: variant.id },
    })
    await appendAuditLog(transaction, {
      action: 'product.creative_variant_approved',
      actor: getAuditActor(context.principal),
      entityId: variant.id,
      entityType: 'creative_variant',
      metadata: { status: input.status },
      organizationId: context.organizationId,
      requestId: context.requestId,
    })
    return { approval, variant: updated }
  })
}
