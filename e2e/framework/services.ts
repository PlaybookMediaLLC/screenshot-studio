import { PrismaClient } from '@prisma/client'
import { S3Client } from '@aws-sdk/client-s3'
import { createClient, type RedisClientType } from 'redis'

function getRequiredEnvironment(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} must be set by the local stack command.`)
  }

  return value
}

export function createE2EDatabaseClient(): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url: getRequiredEnvironment('E2E_DATABASE_URL') } },
  })
}

export function createE2EObjectStoreClient(): S3Client {
  return new S3Client({
    credentials: {
      accessKeyId: getRequiredEnvironment('E2E_R2_ACCESS_KEY_ID'),
      secretAccessKey: getRequiredEnvironment('E2E_R2_SECRET_ACCESS_KEY'),
    },
    endpoint: getRequiredEnvironment('E2E_R2_ENDPOINT'),
    forcePathStyle: true,
    region: getRequiredEnvironment('E2E_R2_REGION'),
  })
}

export function getE2EObjectStoreBucket(): string {
  return getRequiredEnvironment('E2E_R2_BUCKET_NAME')
}

/**
 * Put a workspace on a paid plan.
 *
 * Workspaces start on `free`, and RFC 034 makes commercial capability a
 * server-owned entitlement that tenant APIs deliberately cannot mutate. A spec
 * that needs to exercise a gated capability therefore has to grant it out of
 * band, the same way billing would. Writing the row directly keeps the
 * entitlement server-owned rather than adding a test-only API that would
 * itself become a bypass.
 *
 * The row alone is not enough. `getEntitlementSnapshot` reads through a Redis
 * key with a 30s TTL and a 5s in-process cache, so a fresh grant stays
 * invisible until both expire and the request still sees `currentPlan: free`.
 * Deleting the Redis key removes the shared layer; the per-process cache
 * cannot be reached from here, so callers must tolerate up to its 5s window.
 */
export async function grantWorkspacePlan(organizationId: string, plan: string): Promise<void> {
  const database = createE2EDatabaseClient()
  try {
    await database.workspaceEntitlement.upsert({
      create: { organizationId, plan, status: 'active' },
      update: { plan, status: 'active' },
      where: { organizationId },
    })
  } finally {
    await database.$disconnect()
  }

  await clearEntitlementCache(organizationId)
}

/** Mirrors `cacheKey` in lib/tenant/entitlements.ts. */
async function clearEntitlementCache(organizationId: string): Promise<void> {
  await withRedis(async (client) => {
    await client.del(`screenshot-studio:entitlement:${organizationId}`)
  })
}

/**
 * Drop every rate-limit counter.
 *
 * The invitation policy allows 10 requests per hour and is keyed by client
 * IP (`getClientIdentifier`), so every spec in a shard draws on one shared
 * budget from a single browser host. role-permissions alone invites five
 * roles, and workspace-switching and authorization-revocation invite more,
 * so a later spec receives 429 for a request its own logic never
 * rate-limited. That is a property of running the suite on one address, not
 * a defect the spec should assert against.
 *
 * Clearing between tests keeps each spec's rate-limit behaviour its own.
 * `smoke-rate-limit` still covers the limiter itself, so this does not
 * remove coverage of the policy.
 */
export async function clearRateLimits(): Promise<void> {
  await withRedis(async (client) => {
    const keys = await client.keys('screenshot-studio:rate-limit:*')
    if (keys.length > 0) await client.del(keys)
  })
}

async function withRedis(operation: (client: RedisClientType) => Promise<void>): Promise<void> {
  const url = process.env.E2E_REDIS_URL ?? process.env.REDIS_URL
  if (!url) return

  const client: RedisClientType = createClient({ url })
  try {
    await client.connect()
    await operation(client)
  } catch {
    // Falling back to the TTL is correct: the state still expires on its own,
    // it just takes the full window.
  } finally {
    await client.quit().catch(() => {})
  }
}
