import 'server-only'

import { apiKeyScopePermissions } from '@/lib/auth/api-key-scopes'
import { auth } from '@/lib/auth/server'
import { backendSDK, serviceBackend, withDates } from '@/lib/backend/sdk'
import {
  workspaceApiKeyDeleteSchema,
  workspaceApiKeySchema,
} from '@/lib/tenant/workspace-settings-schema'
import { router } from '../init'
import { organizationProcedure } from '../procedures'

const dayInSeconds = 24 * 60 * 60

/** An agent connected through OAuth keeps its client's name in the key metadata (RFC 037). */
function agentClientOf(metadata: unknown): string | null {
  try {
    const parsed: unknown = typeof metadata === 'string' ? JSON.parse(metadata) : metadata
    if (parsed && typeof parsed === 'object' && 'source' in parsed && parsed.source === 'agent') {
      return 'clientName' in parsed && typeof parsed.clientName === 'string' ? parsed.clientName : 'AI agent'
    }
  } catch {
    // Metadata Better Auth wrote for other keys is not ours to read.
  }
  return null
}

function getPermissions(scopes: readonly (keyof typeof apiKeyScopePermissions)[]) {
  return scopes.reduce<Record<string, string[]>>((permissions, scope) => {
    const [resource, actions] = Object.entries(apiKeyScopePermissions[scope])[0] ?? []
    if (resource && actions) permissions[resource] = actions
    return permissions
  }, {})
}

export const apiKeyRouter = router({
  list: organizationProcedure('brand:manage').query(async ({ ctx }) => {
    const { rows } = await serviceBackend().authStore({
      model: 'apikey',
      op: 'findMany',
      select: ['createdAt', 'enabled', 'expiresAt', 'id', 'metadata', 'name', 'prefix', 'start'],
      sortBy: { direction: 'desc', field: 'createdAt' },
      where: [{ field: 'referenceId', value: ctx.access.organizationId }],
    })
    const keys = withDates(
      (rows ?? []) as {
        createdAt: string
        enabled: boolean | null
        expiresAt: string | null
        id: string
        metadata: unknown
        name: string | null
        prefix: string | null
        start: string | null
      }[]
    ).map(({ metadata, ...key }) => ({ ...key, agentClient: agentClientOf(metadata) }))
    return { keys }
  }),
  create: organizationProcedure('brand:manage')
    .input(workspaceApiKeySchema)
    .mutation(async ({ ctx, input }) => {
      const apiKey = await auth.api.createApiKey({
        body: {
          expiresIn: input.expiresInDays ? input.expiresInDays * dayInSeconds : null,
          name: input.name,
          organizationId: ctx.access.organizationId,
          permissions: getPermissions(input.scopes),
          userId: ctx.access.principal.userId,
        },
      })
      await backendSDK(ctx.access).appendAuditEvent({
        action: 'product.api_key_created',
        entityId: apiKey.id,
        entityType: 'api_key',
      })
      return { apiKey }
    }),
  revoke: organizationProcedure('brand:manage')
    .input(workspaceApiKeyDeleteSchema)
    .mutation(async ({ ctx, input }) => {
      // Scoped to the workspace: another workspace's key id deletes nothing.
      const { count } = await serviceBackend().authStore({
        model: 'apikey',
        op: 'deleteMany',
        where: [
          { field: 'id', value: input.keyId },
          { field: 'referenceId', value: ctx.access.organizationId },
        ],
      })
      if (count) {
        await backendSDK(ctx.access).appendAuditEvent({
          action: 'product.api_key_revoked',
          entityId: input.keyId,
          entityType: 'api_key',
        })
      }
      return { success: true as const }
    }),
})
