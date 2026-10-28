import { S3Client } from '@aws-sdk/client-s3'
import { Pool, types, type CustomTypesConfig, type QueryResultRow } from 'pg'

function getRequiredEnvironment(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} must be set by the local stack command.`)
  }

  return value
}

/**
 * A direct Postgres pool. Tables use the Prisma `@@map` names and camelCase
 * columns, so quote every column. Specs use `db`, which shares one pool per
 * worker; a caller that makes its own pool calls `end()` when done.
 */
export function createE2EDatabase(): Pool {
  // `?schema=public` is a Prisma URL option that pg does not understand.
  const url = new URL(getRequiredEnvironment('E2E_DATABASE_URL'))
  url.searchParams.delete('schema')
  return new Pool({ connectionString: url.toString(), types: UTC_TIMESTAMPS })
}

// `timestamp without time zone` columns hold UTC. pg reads them in the runner's
// local zone by default, which shifts every value off a UTC machine.
const UTC_TIMESTAMPS = {
  getTypeParser: (oid: number, format?: 'text' | 'binary') =>
    oid === types.builtins.TIMESTAMP && format !== 'binary'
      ? (value: string) => new Date(`${value.replace(' ', 'T')}Z`)
      : types.getTypeParser(oid, format),
} as CustomTypesConfig

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

let sharedPool: Pool | null = null

function sharedDatabase(): Pool {
  sharedPool ??= createE2EDatabase()
  return sharedPool
}

/** Closes the worker's pool. The framework calls it when the worker stops. */
export async function closeSharedDatabase(): Promise<void> {
  await sharedPool?.end()
  sharedPool = null
}

/**
 * The worker's database: one pool, opened on first use, for seeding and
 * durable assertions. Specs never close it.
 */
export const db = {
  query: <T extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []) =>
    sharedDatabase().query<T>(text, values),
  row: <T extends QueryResultRow>(text: string, values: unknown[] = []) =>
    queryRow<T>(sharedDatabase(), text, values),
  rows: <T extends QueryResultRow>(text: string, values: unknown[] = []) =>
    queryRows<T>(sharedDatabase(), text, values),
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
 * Workspaces start on `free`, and RFC 014 makes commercial capability a
 * server-owned entitlement that tenant APIs deliberately cannot mutate. A spec
 * that needs to exercise a gated capability therefore has to grant it out of
 * band, the same way billing would. Writing the row directly keeps the
 * entitlement server-owned rather than adding a test-only API that would
 * itself become a bypass. The Go backend reads `workspace_entitlement` on
 * every check, so the grant applies to the next request.
 */
export async function grantWorkspacePlan(organizationId: string, plan: string): Promise<void> {
  await db.query(
    `INSERT INTO workspace_entitlement ("organizationId", plan, status, "updatedAt")
     VALUES ($1, $2, 'active', now())
     ON CONFLICT ("organizationId")
     DO UPDATE SET plan = EXCLUDED.plan, status = 'active', "updatedAt" = now()`,
    [organizationId, plan]
  )
}
