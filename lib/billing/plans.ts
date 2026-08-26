import { z } from 'zod'

export const workspacePlanSchema = z.enum(['free', 'pro', 'business', 'enterprise'])
export type WorkspacePlan = z.infer<typeof workspacePlanSchema>

export const workspaceFeatureSchema = z.enum([
  'asset:create',
  'asset:read',
  'asset:update',
  'asset:delete',
  'release:create',
  'source-app:create',
  'enterprise:audit-drain',
  'enterprise:sso',
  'enterprise:scim',
])
export type WorkspaceFeature = z.infer<typeof workspaceFeatureSchema>

export const workspaceQuotaSchema = z.enum([
  'api:write:minute',
  'storage:bytes',
  'generation:monthly',
  'jobs:concurrent',
])
export type WorkspaceQuota = z.infer<typeof workspaceQuotaSchema>

export const featureOverrideSchema = z
  .partialRecord(workspaceFeatureSchema, z.boolean())
  .default({})

const planFeatures = {
  free: ['asset:create', 'asset:read', 'release:create', 'source-app:create'],
  pro: [
    'asset:create',
    'asset:read',
    'asset:update',
    'asset:delete',
    'release:create',
    'source-app:create',
  ],
  business: [
    'asset:create',
    'asset:read',
    'asset:update',
    'asset:delete',
    'release:create',
    'source-app:create',
  ],
  enterprise: [
    'asset:create',
    'asset:read',
    'asset:update',
    'asset:delete',
    'release:create',
    'source-app:create',
    'enterprise:audit-drain',
    'enterprise:sso',
    'enterprise:scim',
  ],
} as const satisfies Record<WorkspacePlan, readonly WorkspaceFeature[]>

const minimumPlanByFeature: Record<WorkspaceFeature, WorkspacePlan> = {
  'asset:create': 'free',
  'asset:read': 'free',
  'asset:update': 'pro',
  'asset:delete': 'pro',
  'release:create': 'free',
  'source-app:create': 'free',
  'enterprise:audit-drain': 'enterprise',
  'enterprise:sso': 'enterprise',
  'enterprise:scim': 'enterprise',
}

const planQuotas = {
  free: {
    'api:write:minute': 30,
    'generation:monthly': 25,
    'jobs:concurrent': 1,
    'storage:bytes': 250 * 1024 * 1024,
  },
  pro: {
    'api:write:minute': 300,
    'generation:monthly': 1_000,
    'jobs:concurrent': 5,
    'storage:bytes': 25 * 1024 * 1024 * 1024,
  },
  business: {
    'api:write:minute': 1_500,
    'generation:monthly': 10_000,
    'jobs:concurrent': 25,
    'storage:bytes': 250 * 1024 * 1024 * 1024,
  },
  enterprise: {
    'api:write:minute': 10_000,
    'generation:monthly': 100_000,
    'jobs:concurrent': 250,
    'storage:bytes': 5 * 1024 * 1024 * 1024 * 1024,
  },
} as const satisfies Record<WorkspacePlan, Record<WorkspaceQuota, number>>

type WorkspaceEntitlementSnapshot = {
  featureOverrides?: unknown
  plan?: unknown
  status?: string | null
  graceUntil?: Date | null
  validUntil?: Date | null
}

export type WorkspaceFeatureDecision = {
  allowed: boolean
  currentPlan: WorkspacePlan
  requiredPlan: WorkspacePlan
}

export function hasWorkspaceFeature(
  plan: WorkspacePlan,
  feature: WorkspaceFeature,
  overrides: Partial<Record<WorkspaceFeature, boolean>> = {}
): boolean {
  return overrides[feature] ?? planFeatures[plan].includes(feature as never)
}

export function getMinimumPlan(feature: WorkspaceFeature): WorkspacePlan {
  return minimumPlanByFeature[feature]
}

export function evaluateWorkspaceFeature(
  entitlement: WorkspaceEntitlementSnapshot | null,
  feature: WorkspaceFeature,
  now = new Date()
): WorkspaceFeatureDecision {
  const currentPlan = workspacePlanSchema.catch('free').parse(entitlement?.plan)
  const overrides = featureOverrideSchema.catch({}).parse(entitlement?.featureOverrides)
  const isCurrent = !entitlement?.validUntil || entitlement.validUntil > now
  const isInBillingGrace =
    entitlement?.status === 'past_due' && !!entitlement.graceUntil && entitlement.graceUntil > now
  const isActive = entitlement
    ? (entitlement.status === 'active' || entitlement.status === 'trialing' || isInBillingGrace) &&
      isCurrent
    : true

  return {
    allowed: isActive && hasWorkspaceFeature(currentPlan, feature, overrides),
    currentPlan,
    requiredPlan: getMinimumPlan(feature),
  }
}

export function getWorkspaceQuota(plan: WorkspacePlan, quota: WorkspaceQuota): number {
  return planQuotas[plan][quota]
}
