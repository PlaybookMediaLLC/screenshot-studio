import { z } from 'zod'

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
