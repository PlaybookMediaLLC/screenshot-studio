import { z } from 'zod'

/**
 * Workspace plans. There is no free plan: `free` is the state of a workspace
 * without a subscription, and it has no features and no allowances.
 */
export const workspacePlanSchema = z.enum(['free', 'pro', 'business', 'enterprise'])
export type WorkspacePlan = z.infer<typeof workspacePlanSchema>

/** Plans a workspace can buy without talking to sales. */
export const checkoutPlanSchema = workspacePlanSchema.extract(['pro', 'business'])

/** How often a self-serve plan is billed. */
export const billingIntervalSchema = z.enum(['monthly', 'annual'])

/** One-time AI credit packs a workspace can buy on any plan. */
export const creditPackSchema = z.enum(['launch'])

/**
 * What each pack adds and costs. Pack credits are spent after the monthly
 * allowance and do not expire (docs/rfcs/035-pricing-and-unit-economics.md).
 */
export const CREDIT_PACKS: Record<
  z.infer<typeof creditPackSchema>,
  { credits: number; price: string }
> = {
  launch: { credits: 500, price: '$29' },
}

export const workspaceFeatureSchema = z.enum([
  'asset:create',
  'asset:read',
  'asset:update',
  'asset:delete',
  'release:create',
  'source-app:create',
  // Using the product at all: the editor, the tools, and the API.
  'workspace:use',
  'enterprise:audit-drain',
  'enterprise:sso',
  'enterprise:scim',
  // The campaign workflow. Every paid plan includes it; featureOverrides can
  // still grant or revoke it per workspace.
  'campaign:workflow',
  // Hand-written content drafts scheduled to channels (RFC 037).
  'content:drafts',
])
export type WorkspaceFeature = z.infer<typeof workspaceFeatureSchema>

/**
 * Metered workspace quotas. The monthly ones reset at the start of each UTC
 * calendar month and are metered in the Go backend's Redis store. One AI
 * credit is $0.01 of model spend at list price (docs/rfcs/035).
 */
export const workspaceQuotaSchema = z.enum([
  'api:write:minute',
  'storage:bytes',
  'ai:credits:monthly',
  'posts:monthly',
  'emails:monthly',
  'jobs:concurrent',
])
export type WorkspaceQuota = z.infer<typeof workspaceQuotaSchema>

/** Caps on what a workspace holds, rather than on what it uses each month. */
export const workspaceLimitSchema = z.enum(['seats', 'channels'])
export type WorkspaceLimit = z.infer<typeof workspaceLimitSchema>

export const featureOverrideSchema = z
  .partialRecord(workspaceFeatureSchema, z.boolean())
  .default({})

const planFeatures = {
  free: [],
  pro: [
    'asset:create',
    'asset:read',
    'asset:update',
    'asset:delete',
    'release:create',
    'source-app:create',
    'workspace:use',
    'campaign:workflow',
    'content:drafts',
  ],
  business: [
    'asset:create',
    'asset:read',
    'asset:update',
    'asset:delete',
    'release:create',
    'source-app:create',
    'workspace:use',
    'campaign:workflow',
    'content:drafts',
  ],
  enterprise: [
    'asset:create',
    'asset:read',
    'asset:update',
    'asset:delete',
    'release:create',
    'source-app:create',
    'workspace:use',
    'enterprise:audit-drain',
    'enterprise:sso',
    'enterprise:scim',
    'campaign:workflow',
    'content:drafts',
  ],
} as const satisfies Record<WorkspacePlan, readonly WorkspaceFeature[]>

const minimumPlanByFeature: Record<WorkspaceFeature, WorkspacePlan> = {
  'asset:create': 'pro',
  'asset:read': 'pro',
  'asset:update': 'pro',
  'asset:delete': 'pro',
  'release:create': 'pro',
  'source-app:create': 'pro',
  'workspace:use': 'pro',
  'enterprise:audit-drain': 'enterprise',
  'enterprise:sso': 'enterprise',
  'enterprise:scim': 'enterprise',
  'campaign:workflow': 'pro',
  'content:drafts': 'pro',
}

/** Mirrors `planQuotas` in services/internal/product/quota.go. */
const planQuotas = {
  free: {
    'ai:credits:monthly': 0,
    'api:write:minute': 0,
    'emails:monthly': 0,
    'jobs:concurrent': 0,
    'posts:monthly': 0,
    'storage:bytes': 0,
  },
  pro: {
    'ai:credits:monthly': 3_600,
    'api:write:minute': 300,
    'emails:monthly': 5_000,
    'jobs:concurrent': 5,
    'posts:monthly': 120,
    'storage:bytes': 25 * 1024 * 1024 * 1024,
  },
  business: {
    'ai:credits:monthly': 13_200,
    'api:write:minute': 1_500,
    'emails:monthly': 25_000,
    'jobs:concurrent': 25,
    'posts:monthly': 480,
    'storage:bytes': 250 * 1024 * 1024 * 1024,
  },
  enterprise: {
    'ai:credits:monthly': 54_000,
    'api:write:minute': 10_000,
    'emails:monthly': 100_000,
    'jobs:concurrent': 250,
    'posts:monthly': 2_400,
    'storage:bytes': 5 * 1024 * 1024 * 1024 * 1024,
  },
} as const satisfies Record<WorkspacePlan, Record<WorkspaceQuota, number>>

/**
 * Mirrors `planLimits` in services/internal/product/plan_limits.go. `null` is
 * unlimited. A pending invitation holds a seat; only active social channels count.
 */
const planLimits = {
  free: { channels: 0, seats: 1 },
  pro: { channels: 3, seats: 5 },
  business: { channels: 15, seats: 20 },
  enterprise: { channels: null, seats: null },
} as const satisfies Record<WorkspacePlan, Record<WorkspaceLimit, number | null>>

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

/** How many of `limit` a plan's workspace may hold; `null` is unlimited. */
export function getWorkspaceLimit(plan: WorkspacePlan, limit: WorkspaceLimit): number | null {
  return planLimits[plan][limit]
}
