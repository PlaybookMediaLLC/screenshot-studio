import { z } from 'zod'
import { timestampSchema } from '@/lib/api/contract'

/** Expected draft revisions for destructive commands; omitted for legacy clients. */
export const draftVersionsQuerySchema = z.object({
  version: z.coerce.number().int().positive().optional(),
  calendarVersion: z.coerce.number().int().positive().optional(),
})

/** A collaboration token: one member, one draft, a few minutes. */
export const collabTokenSchema = z.object({
  access: z.enum(['read', 'write']),
  documentName: z.string(),
  expiresAt: timestampSchema,
  token: z.string(),
})
