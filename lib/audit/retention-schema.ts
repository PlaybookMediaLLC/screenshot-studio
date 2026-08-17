import { z } from 'zod'

export const auditRetentionQuerySchema = z.object({
  organizationId: z.string().min(1).max(128),
})

export const auditRetentionUpdateSchema = auditRetentionQuerySchema.extend({
  legalHold: z.boolean().default(false),
  retentionDays: z.number().int().min(30).max(3_650),
})
