import { z } from 'zod'

/** Expected draft revisions for destructive commands; omitted for legacy clients. */
export const draftVersionsQuerySchema = z.object({
  version: z.coerce.number().int().positive().optional(),
  calendarVersion: z.coerce.number().int().positive().optional(),
})
