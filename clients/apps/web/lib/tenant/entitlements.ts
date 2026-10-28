import 'server-only'

import { BackendSDKError } from 'screenshot-studio-backend-sdk'
import type { TenantContext } from '@/lib/auth/access'
import { backendSDK } from '@/lib/backend/sdk'
import { requestRead } from '@/lib/auth/request-reads'
import type { WorkspaceFeature, WorkspacePlan, WorkspaceQuota } from '@/lib/billing/plans'

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

export class WorkspaceQuotaError extends Error {
  readonly status = 429

  constructor(
    readonly quota: WorkspaceQuota,
    readonly limit: number,
    readonly resetAt: number
  ) {
    super(`The workspace has exceeded its ${quota} plan quota.`)
    this.name = 'WorkspaceQuotaError'
  }
}

/** The backend evaluates the canonical workspace entitlement on every check. */
export async function requireWorkspaceFeature(
  context: TenantContext,
  feature: WorkspaceFeature
): Promise<void> {
  const decision = await requestRead(
    JSON.stringify(['feature', context.organizationId, context.principal, feature]),
    () => backendSDK(context).getFeatureDecision(feature)
  )
  if (!decision.allowed) {
    throw new WorkspaceEntitlementError(
      feature,
      decision.currentPlan as WorkspacePlan,
      decision.requiredPlan as WorkspacePlan
    )
  }
}

/**
 * Check several gates in one round trip. The first gate in `features` that
 * fails is the error, as if they had been checked one after another.
 */
export async function requireWorkspaceFeatures(
  context: TenantContext,
  features: WorkspaceFeature[]
): Promise<void> {
  const results = await Promise.allSettled(
    features.map((feature) => requireWorkspaceFeature(context, feature))
  )
  for (const result of results) if (result.status === 'rejected') throw result.reason
}

/**
 * Metered quotas count in the backend's shared counter and fail closed when
 * it is unavailable. Returns what is left; an amount of 0 only reads it.
 */
export async function consumeWorkspaceQuota(
  context: TenantContext,
  quota: WorkspaceQuota,
  amount = 1
): Promise<number> {
  try {
    return (await backendSDK(context).consumeWorkspaceQuota(quota, amount)).remaining
  } catch (error) {
    if (error instanceof BackendSDKError && error.status === 429) {
      const { limit, resetAt } = error.details
      throw new WorkspaceQuotaError(
        quota,
        typeof limit === 'number' ? limit : 0,
        typeof resetAt === 'number' ? resetAt : Date.now() + 60_000
      )
    }
    throw error
  }
}
