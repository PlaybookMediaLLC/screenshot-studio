import { type AuditLog, Prisma, type AuditOutcome } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/db'

const dateSchema = z.coerce.date()

export const auditLogQuerySchema = z.object({
  action: z.string().min(1).max(120).optional(),
  actorUserId: z.string().min(1).max(128).optional(),
  cursor: z.string().cuid().optional(),
  endDate: dateSchema.optional(),
  entityType: z.string().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  organizationId: z.string().min(1).max(128),
  outcome: z.enum(['SUCCEEDED', 'FAILED', 'DENIED']).optional(),
  search: z.string().min(1).max(200).optional(),
  startDate: dateSchema.optional(),
})

export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>

function getAuditWhere(input: AuditLogQuery): Prisma.AuditLogWhereInput {
  return {
    action: input.action,
    actorUserId: input.actorUserId,
    createdAt: { gte: input.startDate, lte: input.endDate },
    entityType: input.entityType,
    organizationId: input.organizationId,
    outcome: input.outcome as AuditOutcome | undefined,
    searchText: input.search ? { contains: input.search, mode: 'insensitive' } : undefined,
  }
}

export type AuditLogPage = {
  items: AuditLog[]
  nextCursor?: string
}

export async function listAuditLogs(input: AuditLogQuery): Promise<AuditLogPage> {
  const items = await prisma.auditLog.findMany({
    cursor: input.cursor ? { id: input.cursor } : undefined,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: input.cursor ? 1 : 0,
    take: input.limit,
    where: getAuditWhere(input),
  })
  const lastItem = items.at(-1)
  return { items, nextCursor: items.length === input.limit ? lastItem?.id : undefined }
}
