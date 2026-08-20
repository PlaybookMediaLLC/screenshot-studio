import { z } from 'zod'

export const workspaceNameSchema = z.string().trim().min(2, 'Enter a workspace name.').max(100)

export const workspaceSlugSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers, and hyphens only.')
  .min(2)
  .max(100)

export const workspaceCreateSchema = z.object({
  name: workspaceNameSchema,
  slug: workspaceSlugSchema,
})
