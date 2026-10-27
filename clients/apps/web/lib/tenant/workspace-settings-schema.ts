import { z } from 'zod'
import { apiKeyScopes } from '@/lib/auth/api-key-scopes'
export { workspaceUpdateSchema } from '@/lib/workspace/schemas'

export const workspaceApiKeySchema = z.object({
  expiresInDays: z.coerce.number().int().min(1).max(365).optional(),
  name: z.string().trim().min(2).max(32),
  scopes: z.array(z.enum(apiKeyScopes)).min(1).max(apiKeyScopes.length),
})

export const workspaceApiKeyDeleteSchema = z.object({
  keyId: z.string().min(1).max(128),
})

export type WorkspaceApiKeyInput = z.infer<typeof workspaceApiKeySchema>
