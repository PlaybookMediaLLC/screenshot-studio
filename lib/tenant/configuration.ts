import 'server-only'

import { appendAuditLog } from '@/lib/audit/log'
import type { TenantContext } from '@/lib/auth/access'
import { getAuditActor } from '@/lib/auth/principal'
import { prisma } from '@/lib/db'
import type { BrandKitCreateInput, SourceAppCreateInput } from './schemas'

export async function createBrandKit(context: TenantContext, input: BrandKitCreateInput) {
  return prisma.$transaction(async (transaction) => {
    const current = await transaction.brandKit.findFirst({
      orderBy: { version: 'desc' },
      select: { version: true },
      where: { name: input.name, organizationId: context.organizationId },
    })
    const brandKit = await transaction.brandKit.create({
      data: {
        definition: input.definition,
        name: input.name,
        organizationId: context.organizationId,
        status: input.publish ? 'ACTIVE' : 'DRAFT',
        version: (current?.version ?? 0) + 1,
      },
    })
    await appendAuditLog(transaction, {
      action: 'product.brand_kit_created',
      actor: getAuditActor(context.principal),
      entityId: brandKit.id,
      entityType: 'brand_kit',
      organizationId: context.organizationId,
      requestId: context.requestId,
    })
    return brandKit
  })
}

export async function createSourceApp(context: TenantContext, input: SourceAppCreateInput) {
  return prisma.$transaction(async (transaction) => {
    const sourceApp = await transaction.sourceApp.create({
      data: {
        allowedHosts: input.allowedHosts,
        externalId: input.externalId,
        name: input.name,
        organizationId: context.organizationId,
        provider: input.provider,
        secretReference: input.secretReference,
        status: 'ACTIVE',
      },
    })
    await appendAuditLog(transaction, {
      action: 'product.source_app_created',
      actor: getAuditActor(context.principal),
      entityId: sourceApp.id,
      entityType: 'source_app',
      organizationId: context.organizationId,
      requestId: context.requestId,
    })
    return sourceApp
  })
}
