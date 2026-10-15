import 'server-only'

import { BackendSDKError } from 'screenshot-studio-backend-sdk'
import type { TenantContext } from '@/lib/auth/access'
import { backendSDK } from '@/lib/backend/sdk'
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

/** The backend reports a plan gate as a 403 that carries the feature decision. */
export function asEntitlementError(error: unknown): WorkspaceEntitlementError | null {
  if (error instanceof WorkspaceEntitlementError) return error
  if (!(error instanceof BackendSDKError)) return null
  const { code, currentPlan, feature, requiredPlan } = error.details
  if (code !== 'workspace_feature_not_entitled') return null
  return new WorkspaceEntitlementError(
    feature as WorkspaceFeature,
    currentPlan as WorkspacePlan,
    requiredPlan as WorkspacePlan
  )
}

/** The backend evaluates the canonical workspace entitlement on every check. */
export async function requireWorkspaceFeature(
  context: TenantContext,
  feature: WorkspaceFeature
): Promise<void> {
  const decision = await backendSDK(context).getFeatureDecision(feature)
  if (!decision.allowed) {
    throw new WorkspaceEntitlementError(
      feature,
      decision.currentPlan as WorkspacePlan,
      decision.requiredPlan as WorkspacePlan
    )
  }
}

/**
 * Metered quotas count in the backend's shared counter and fail closed when
 * it is unavailable.
 */
export async function consumeWorkspaceQuota(
  context: TenantContext,
  quota: WorkspaceQuota,
  amount = 1
): Promise<void> {
  try {
    await backendSDK(context).consumeWorkspaceQuota(quota, amount)
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
