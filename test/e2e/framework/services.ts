import { S3Client } from '@aws-sdk/client-s3'
import { Pool, type QueryResultRow } from 'pg'
import { createClient, type RedisClientType } from 'redis'

function getRequiredEnvironment(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} must be set by the local stack command.`)
  }

  return value
}

/**
 * A direct Postgres pool for seeding and durable assertions. Tables use the
 * Prisma `@@map` names and camelCase columns, so quote every column. Call
 * `end()` when done.
 */
export function createE2EDatabase(): Pool {
  // `?schema=public` is a Prisma URL option that pg does not understand.
  const url = new URL(getRequiredEnvironment('E2E_DATABASE_URL'))
  url.searchParams.delete('schema')
  return new Pool({ connectionString: url.toString() })
}

export async function queryRows<T extends QueryResultRow>(
  database: Pool,
  text: string,
  values: unknown[] = []
): Promise<T[]> {
  return (await database.query<T>(text, values)).rows
}

/** The first row, or null when the query matches nothing. */
export async function queryRow<T extends QueryResultRow>(
  database: Pool,
  text: string,
  values: unknown[] = []
): Promise<T | null> {
  return (await queryRows<T>(database, text, values))[0] ?? null
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
 * itself become a bypass. The Go backend reads `workspace_entitlement` on
 * every check, so the grant applies to the next request.
 */
export async function grantWorkspacePlan(organizationId: string, plan: string): Promise<void> {
  const database = createE2EDatabase()
  try {
    await database.query(
      `INSERT INTO workspace_entitlement ("organizationId", plan, status, "updatedAt")
       VALUES ($1, $2, 'active', now())
       ON CONFLICT ("organizationId")
       DO UPDATE SET plan = EXCLUDED.plan, status = 'active', "updatedAt" = now()`,
      [organizationId, plan]
    )
  } finally {
    await database.end()
  }
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
