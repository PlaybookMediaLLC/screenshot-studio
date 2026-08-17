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
