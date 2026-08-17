import { PrismaClient } from '@prisma/client'

const globalForAuditRetentionPrisma = globalThis as unknown as {
  auditRetentionPrisma: PrismaClient | undefined
}

function getRetentionDatabaseUrl(): string | undefined {
  return process.env.AUDIT_RETENTION_DATABASE_URL ?? process.env.DATABASE_URL
}

export function assertAuditRetentionDatabase(): void {
  if (process.env.NODE_ENV === 'production' && !process.env.AUDIT_RETENTION_DATABASE_URL) {
    throw new Error('AUDIT_RETENTION_DATABASE_URL is required in production.')
  }
}

export const auditRetentionPrisma =
  globalForAuditRetentionPrisma.auditRetentionPrisma ??
  new PrismaClient({ datasources: { db: { url: getRetentionDatabaseUrl() } } })

if (process.env.NODE_ENV !== 'production') {
  globalForAuditRetentionPrisma.auditRetentionPrisma = auditRetentionPrisma
}
