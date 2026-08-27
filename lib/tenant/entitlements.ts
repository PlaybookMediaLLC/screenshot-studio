import 'server-only'

import { prisma } from '@/lib/db'
import { getRedisClient } from '@/lib/redis'
import {
  evaluateWorkspaceFeature,
  getWorkspaceQuota,
  type WorkspaceFeature,
  type WorkspacePlan,
  type WorkspaceQuota,
} from '@/lib/billing/plans'

const CACHE_TTL_SECONDS = 30
const localCache = new Map<string, { expiresAt: number; value: EntitlementSnapshot | null }>()

type EntitlementSnapshot = {
  featureOverrides: unknown
  graceUntil: Date | null
  plan: string
  status: string
  validUntil: Date | null
  version: number
}

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

function cacheKey(organizationId: string): string {
  return `screenshot-studio:entitlement:${organizationId}`
}

function deserializeSnapshot(value: string): EntitlementSnapshot | null {
  const parsed = JSON.parse(value) as EntitlementSnapshot | null
  if (!parsed) return null
  return {
    ...parsed,
    graceUntil: parsed.graceUntil ? new Date(parsed.graceUntil) : null,
    validUntil: parsed.validUntil ? new Date(parsed.validUntil) : null,
  }
}

async function getEntitlementSnapshot(organizationId: string): Promise<EntitlementSnapshot | null> {
  const local = localCache.get(organizationId)
  if (local && local.expiresAt > Date.now()) return local.value

  try {
    const redis = await getRedisClient()
    const cached = await redis.get(cacheKey(organizationId))
    if (cached) {
      const value = deserializeSnapshot(cached)
      localCache.set(organizationId, { expiresAt: Date.now() + 5_000, value })
      return value
    }
  } catch {
    // Database remains authoritative when the optional cache is unavailable.
  }

  const value = await prisma.workspaceEntitlement.findUnique({
    select: {
      featureOverrides: true,
      graceUntil: true,
      plan: true,
      status: true,
      validUntil: true,
      version: true,
    },
    where: { organizationId },
  })
  localCache.set(organizationId, { expiresAt: Date.now() + 5_000, value })
  try {
    const redis = await getRedisClient()
    await redis.set(cacheKey(organizationId), JSON.stringify(value), { EX: CACHE_TTL_SECONDS })
  } catch {
    // A cache outage must not make authorization unavailable.
  }
  return value
}

export async function invalidateWorkspaceEntitlement(organizationId: string): Promise<void> {
  localCache.delete(organizationId)
  try {
    const redis = await getRedisClient()
    await redis.del(cacheKey(organizationId))
  } catch {
    // The bounded local/Redis TTL prevents indefinite stale authorization.
  }
}

export async function requireWorkspaceFeature(
  organizationId: string,
  feature: WorkspaceFeature
): Promise<void> {
  const entitlement = await getEntitlementSnapshot(organizationId)
  const decision = evaluateWorkspaceFeature(entitlement, feature)

  if (!decision.allowed) {
    throw new WorkspaceEntitlementError(feature, decision.currentPlan, decision.requiredPlan)
  }
}

export async function consumeWorkspaceQuota(
  organizationId: string,
  quota: WorkspaceQuota,
  amount = 1
): Promise<void> {
  const entitlement = await getEntitlementSnapshot(organizationId)
  const decision = evaluateWorkspaceFeature(entitlement, 'asset:read')
  const limit = getWorkspaceQuota(decision.currentPlan, quota)
  const windowMs = quota === 'api:write:minute' ? 60_000 : 30 * 24 * 60 * 60 * 1_000
  const resetAt = Date.now() + windowMs

  try {
    const redis = await getRedisClient()
    const key = `screenshot-studio:quota:${quota}:${organizationId}:${Math.floor(Date.now() / windowMs)}`
    const count = await redis.incrBy(key, amount)
    if (count === amount) await redis.pExpire(key, windowMs)
    if (count > limit) throw new WorkspaceQuotaError(quota, limit, resetAt)
  } catch (error) {
    if (error instanceof WorkspaceQuotaError) throw error
    // Costly write quotas fail closed when the distributed counter is unavailable.
    throw new WorkspaceQuotaError(quota, limit, resetAt)
  }
}

export async function requireWorkspaceQuotaCapacity(
  organizationId: string,
  quota: WorkspaceQuota,
  used: number,
  requested = 0
): Promise<void> {
  const entitlement = await getEntitlementSnapshot(organizationId)
  const decision = evaluateWorkspaceFeature(entitlement, 'asset:read')
  const limit = getWorkspaceQuota(decision.currentPlan, quota)
  if (used + requested > limit) {
    throw new WorkspaceQuotaError(quota, limit, Date.now() + 60_000)
  }
}
