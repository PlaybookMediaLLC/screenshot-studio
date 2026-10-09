import 'server-only'

import type { Prisma } from '@prisma/client'
import { appendAuditLog } from '@/lib/audit/log'
import type { TenantContext } from '@/lib/auth/access'
import { getAuditActor } from '@/lib/auth/principal'
import { prisma } from '@/lib/db'
import { type DesignDocument, designDocumentSchema, getDesignAssetIds } from '@/lib/design/document'

export class DesignError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404
  ) {
    super(message)
    this.name = 'DesignError'
  }
}

const designSelect = {
  campaignId: true,
  createdAt: true,
  document: true,
  id: true,
  name: true,
  parentDesignId: true,
  planAssetKey: true,
  planVersion: true,
  renderedAssetId: true,
  templateId: true,
  updatedAt: true,
  variantLabel: true,
} as const

/**
 * A document may only reference uploaded assets of its own workspace. The
 * renderer signs whatever a design names, so this check is what keeps one
 * tenant's design from rendering another tenant's images.
 */
async function requireDesignAssets(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  document: DesignDocument
) {
  const assetIds = getDesignAssetIds(document)
  if (assetIds.length === 0) return
  const found = await transaction.asset.count({
    where: { id: { in: assetIds }, organizationId, status: 'UPLOADED' },
  })
  if (found !== assetIds.length) {
    throw new DesignError('The design references an image that is not in this workspace.', 404)
  }
}

export async function createDesign(
  context: TenantContext,
  input: {
    campaignId?: string
    document: unknown
    name: string
    parentDesignId?: string
    /** Plan asset this design realizes (A1…) and its A/B label. */
    planAssetKey?: string
    planVersion?: number
    templateId?: string
    variantLabel?: string
  }
) {
  const document = designDocumentSchema.parse(input.document)
  return prisma.$transaction(async (transaction) => {
    await requireDesignAssets(transaction, context.organizationId, document)
    if (input.campaignId) {
      const campaign = await transaction.campaign.findFirst({
        select: { id: true },
        where: { id: input.campaignId, organizationId: context.organizationId },
      })
      if (!campaign) throw new DesignError('Campaign not found.', 404)
    }
    if (input.parentDesignId) {
      const parent = await transaction.design.findFirst({
        select: { id: true },
        where: { id: input.parentDesignId, organizationId: context.organizationId },
      })
      if (!parent) throw new DesignError('Design not found.', 404)
    }
    const design = await transaction.design.create({
      data: {
        campaignId: input.campaignId ?? null,
        createdByUserId: context.principal.kind === 'session' ? context.principal.userId : null,
        document,
        name: input.name,
        organizationId: context.organizationId,
        parentDesignId: input.parentDesignId ?? null,
        planAssetKey: input.planAssetKey ?? null,
        planVersion: input.planVersion ?? null,
        templateId: input.templateId ?? document.template ?? null,
        variantLabel: input.variantLabel ?? null,
      },
      select: designSelect,
    })
    await appendAuditLog(transaction, {
      action: 'product.design_created',
      actor: getAuditActor(context.principal),
      entityId: design.id,
      entityType: 'design',
      metadata: {
        campaignId: design.campaignId,
        parentDesignId: design.parentDesignId,
        templateId: design.templateId,
      },
      organizationId: context.organizationId,
      requestId: context.requestId,
    })
    return { ...design, document }
  })
}

export async function getDesign(organizationId: string, designId: string) {
  const design = await prisma.design.findFirst({
    select: designSelect,
    where: { id: designId, organizationId },
  })
  return design ? { ...design, document: designDocumentSchema.parse(design.document) } : null
}

export async function updateDesignDocument(
  context: TenantContext,
  designId: string,
  document: DesignDocument
) {
  return prisma.$transaction(async (transaction) => {
    await requireDesignAssets(transaction, context.organizationId, document)
    const updated = await transaction.design.updateMany({
      data: { document, templateId: document.template ?? null },
      where: { id: designId, organizationId: context.organizationId },
    })
    if (updated.count === 0) throw new DesignError('Design not found.', 404)
    await appendAuditLog(transaction, {
      action: 'product.design_updated',
      actor: getAuditActor(context.principal),
      entityId: designId,
      entityType: 'design',
      organizationId: context.organizationId,
      requestId: context.requestId,
    })
  })
}

export async function setDesignRender(
  context: TenantContext,
  designId: string,
  assetId: string,
  renderKey: string | null = null
) {
  const updated = await prisma.design.updateMany({
    data: { renderedAssetId: assetId, renderKey },
    where: { id: designId, organizationId: context.organizationId },
  })
  if (updated.count === 0) throw new DesignError('Design not found.', 404)
}

export async function listCampaignDesigns(organizationId: string, campaignId: string) {
  return prisma.design.findMany({
    include: {
      renderedAsset: { select: { height: true, id: true, objectKey: true, width: true } },
    },
    orderBy: { createdAt: 'asc' },
    where: { campaignId, organizationId },
  })
}
