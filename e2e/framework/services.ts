import { PrismaClient } from '@prisma/client'
import { S3Client } from '@aws-sdk/client-s3'
import { createClient } from 'redis'

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
  const url = process.env.E2E_REDIS_URL ?? process.env.REDIS_URL
  if (!url) return

  const client = createClient({ url })
  try {
    await client.connect()
    await client.del(`screenshot-studio:entitlement:${organizationId}`)
  } catch {
    // Falling back to the TTL is correct: the grant still lands, it just takes
    // up to 30s to become visible.
  } finally {
    await client.quit().catch(() => {})
  }
}
