import { z } from 'zod'
import { workspaceNameInputSchema, workspaceNameSchema } from 'screenshot-studio-backend-sdk'

export { workspaceNameSchema }

export const workspaceSlugSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers, and hyphens only.')
  .min(2)
  .max(100)

export const workspaceCreateSchema = z.object({
  name: workspaceNameInputSchema,
  slug: workspaceSlugSchema,
  idempotencyKey: z.uuid().optional(),
  keepCurrentActiveOrganization: z.boolean().optional(),
})
