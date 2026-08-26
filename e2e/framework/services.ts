import { PrismaClient } from '@prisma/client'
import { S3Client } from '@aws-sdk/client-s3'

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
}
