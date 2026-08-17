import 'server-only'

import { appendAuditLog } from '@/lib/audit/log'
import type { TenantContext } from '@/lib/auth/access'
import { getAuditActor } from '@/lib/auth/principal'
import { prisma } from '@/lib/db'
import type { ProductSurfaceCreateInput, ProductSurfaceUpdateInput } from './schemas'

export async function listProductSurfaces(organizationId: string) {
  return prisma.productSurface.findMany({
    orderBy: { name: 'asc' },
    where: { organizationId },
  })
}

export async function createProductSurface(
  context: TenantContext,
  input: ProductSurfaceCreateInput
) {
  return prisma.$transaction(async (transaction) => {
    const surface = await transaction.productSurface.create({
      data: {
        description: input.description ?? null,
        featureTags: input.featureTags,
        name: input.name,
        organizationId: context.organizationId,
        screenshotAssetIds: input.screenshotAssetIds,
        url: input.url,
      },
    })
    await appendAuditLog(transaction, {
      action: 'product.surface_created',
      actor: getAuditActor(context.principal),
      entityId: surface.id,
      entityType: 'product_surface',
      organizationId: context.organizationId,
      requestId: context.requestId,
    })
    return surface
  })
}

export async function updateProductSurface(
  context: TenantContext,
  surfaceId: string,
  input: ProductSurfaceUpdateInput
) {
  return prisma.$transaction(async (transaction) => {
    const existing = await transaction.productSurface.findFirst({
      select: { id: true },
      where: { id: surfaceId, organizationId: context.organizationId },
    })
    if (!existing) {
      return null
    }
    const surface = await transaction.productSurface.update({
      data: {
        ...(input.description !== undefined && { description: input.description }),
        ...(input.featureTags !== undefined && { featureTags: input.featureTags }),
        ...(input.name !== undefined && { name: input.name }),
        ...(input.screenshotAssetIds !== undefined && {
          screenshotAssetIds: input.screenshotAssetIds,
        }),
        ...(input.url !== undefined && { url: input.url }),
      },
      where: { id: surfaceId },
    })
    await appendAuditLog(transaction, {
      action: 'product.surface_updated',
      actor: getAuditActor(context.principal),
      entityId: surface.id,
      entityType: 'product_surface',
      organizationId: context.organizationId,
      requestId: context.requestId,
    })
    return surface
  })
}

export async function deleteProductSurface(context: TenantContext, surfaceId: string) {
  return prisma.$transaction(async (transaction) => {
    const existing = await transaction.productSurface.findFirst({
      select: { id: true },
      where: { id: surfaceId, organizationId: context.organizationId },
    })
    if (!existing) {
      return null
    }
    await transaction.productSurface.delete({ where: { id: surfaceId } })
    await appendAuditLog(transaction, {
      action: 'product.surface_deleted',
      actor: getAuditActor(context.principal),
      entityId: surfaceId,
      entityType: 'product_surface',
      organizationId: context.organizationId,
      requestId: context.requestId,
    })
    return existing
  })
}
