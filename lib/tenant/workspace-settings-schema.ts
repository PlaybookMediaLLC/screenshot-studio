import { z } from 'zod'
import { apiKeyScopes } from '@/lib/auth/api-key-scopes'

export const workspaceUpdateSchema = z.object({
  name: z.string().trim().min(2).max(100),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .min(2)
    .max(100),
})

export const workspaceApiKeySchema = z.object({
  expiresInDays: z.coerce.number().int().min(1).max(365).optional(),
  name: z.string().trim().min(2).max(32),
  scopes: z.array(z.enum(apiKeyScopes)).min(1).max(apiKeyScopes.length),
})

export const workspaceApiKeyDeleteSchema = z.object({
  keyId: z.string().min(1).max(128),
})

export type WorkspaceApiKeyInput = z.infer<typeof workspaceApiKeySchema>
