import 'server-only'

import { prisma } from '@/lib/db'
import {
  evaluateWorkspaceFeature,
  type WorkspaceFeature,
  type WorkspacePlan,
} from '@/lib/billing/plans'

export class WorkspaceEntitlementError extends Error {
  readonly status = 403

  constructor(
    readonly feature: WorkspaceFeature,
    readonly currentPlan: WorkspacePlan,
    readonly requiredPlan: WorkspacePlan
  ) {
    super(`The ${feature} capability is not available on the current workspace plan.`)
    this.name = 'WorkspaceEntitlementError'
  }
}

export async function requireWorkspaceFeature(
  organizationId: string,
  feature: WorkspaceFeature
): Promise<void> {
  const entitlement = await prisma.workspaceEntitlement.findUnique({
    select: { featureOverrides: true, plan: true, status: true, validUntil: true },
    where: { organizationId },
  })
  const decision = evaluateWorkspaceFeature(entitlement, feature)

  if (!decision.allowed) {
    throw new WorkspaceEntitlementError(feature, decision.currentPlan, decision.requiredPlan)
  }
}
