import 'server-only'

import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { appendAuditLog } from '@/lib/audit/log'
import { prisma } from '@/lib/db'
import { featureOverrideSchema, workspacePlanSchema } from '@/lib/billing/plans'
import { invalidateWorkspaceEntitlement } from '@/lib/tenant/entitlements'

export const entitlementSyncSchema = z.object({
  eventId: z.string().min(1).max(255),
  eventType: z.string().min(1).max(120),
  expectedVersion: z.number().int().nonnegative(),
  externalCustomerId: z.string().max(255).nullish(),
  externalSubscriptionId: z.string().max(255).nullish(),
  featureOverrides: featureOverrideSchema,
  graceUntil: z.coerce.date().nullish(),
  organizationId: z.string().min(1),
  plan: workspacePlanSchema,
  provider: z.string().min(1).max(80),
  status: z.enum(['active', 'trialing', 'past_due', 'suspended', 'cancelled']),
  validUntil: z.coerce.date().nullish(),
})

export class EntitlementSyncError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409
  ) {
    super(message)
    this.name = 'EntitlementSyncError'
  }
}

export async function syncWorkspaceEntitlement(
  input: z.infer<typeof entitlementSyncSchema>
): Promise<{ replayed: boolean; version: number }> {
  let result: { replayed: boolean; version: number }
  try {
    result = await prisma.$transaction(async (transaction) => {
      const replay = await transaction.billingEntitlementEvent.findUnique({
        where: { provider_eventId: { eventId: input.eventId, provider: input.provider } },
      })
      if (replay) return { replayed: true, version: replay.entitlementVersion }

      const organization = await transaction.organization.findUnique({
        select: { id: true },
        where: { id: input.organizationId },
      })
      if (!organization) throw new EntitlementSyncError('Workspace not found.', 404)

      const current = await transaction.workspaceEntitlement.findUnique({
        where: { organizationId: input.organizationId },
      })
      const currentVersion = current?.version ?? 0
      if (currentVersion !== input.expectedVersion) {
        throw new EntitlementSyncError(
          `Entitlement version conflict. Current version is ${currentVersion}.`,
          409
        )
      }
      const version = currentVersion + 1
      const data = {
        externalCustomerId: input.externalCustomerId ?? null,
        externalSubscriptionId: input.externalSubscriptionId ?? null,
        featureOverrides: input.featureOverrides,
        graceUntil: input.graceUntil ?? null,
        lastSyncedAt: new Date(),
        plan: input.plan,
        provider: input.provider,
        status: input.status,
        validUntil: input.validUntil ?? null,
        version,
      }

      if (current) {
        const update = await transaction.workspaceEntitlement.updateMany({
          data,
          where: { organizationId: input.organizationId, version: currentVersion },
        })
        if (update.count !== 1) throw new EntitlementSyncError('Entitlement version conflict.', 409)
      } else {
        await transaction.workspaceEntitlement.create({
          data: { ...data, organizationId: input.organizationId },
        })
      }

      await transaction.billingEntitlementEvent.create({
        data: {
          entitlementVersion: version,
          eventId: input.eventId,
          eventType: input.eventType,
          organizationId: input.organizationId,
          provider: input.provider,
        },
      })
      await appendAuditLog(transaction, {
        action: 'billing.entitlement_changed',
        actor: { display: input.provider, type: 'SERVICE' },
        entityId: input.organizationId,
        entityType: 'workspace_entitlement',
        metadata: {
          currentVersion,
          eventId: input.eventId,
          eventType: input.eventType,
          plan: input.plan,
          status: input.status,
          version,
        },
        organizationId: input.organizationId,
        requestId: input.eventId,
      })
      return { replayed: false, version }
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const replay = await prisma.billingEntitlementEvent.findUnique({
        where: { provider_eventId: { eventId: input.eventId, provider: input.provider } },
      })
      if (replay) return { replayed: true, version: replay.entitlementVersion }
    }
    throw error
  }

  await invalidateWorkspaceEntitlement(input.organizationId)
  return result
}
