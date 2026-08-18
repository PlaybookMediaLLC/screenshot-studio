import 'server-only'

import { appendAuditLog } from '@/lib/audit/log'
import { apiKeyScopePermissions } from '@/lib/auth/api-key-scopes'
import { getAuditActor } from '@/lib/auth/principal'
import { auth } from '@/lib/auth/server'
import { prisma } from '@/lib/db'
import {
  workspaceApiKeyDeleteSchema,
  workspaceApiKeySchema,
} from '@/lib/tenant/workspace-settings-schema'
import { router } from '../init'
import { organizationProcedure } from '../procedures'

const dayInSeconds = 24 * 60 * 60

function getPermissions(scopes: readonly (keyof typeof apiKeyScopePermissions)[]) {
  return scopes.reduce<Record<string, string[]>>((permissions, scope) => {
    const [resource, actions] = Object.entries(apiKeyScopePermissions[scope])[0] ?? []
    if (resource && actions) permissions[resource] = actions
    return permissions
  }, {})
}

export const apiKeyRouter = router({
  list: organizationProcedure('brand:manage').query(async ({ ctx }) => {
    const keys = await prisma.apikey.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        createdAt: true,
        enabled: true,
        expiresAt: true,
        id: true,
        name: true,
        prefix: true,
        start: true,
      },
      where: { referenceId: ctx.access.organizationId },
    })
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
      await prisma.$transaction((transaction) =>
        appendAuditLog(transaction, {
          action: 'product.api_key_created',
          actor: getAuditActor(ctx.access.principal),
          entityId: apiKey.id,
          entityType: 'api_key',
          organizationId: ctx.access.organizationId,
          requestId: ctx.access.requestId,
        })
      )
      return { apiKey }
    }),
  revoke: organizationProcedure('brand:manage')
    .input(workspaceApiKeyDeleteSchema)
    .mutation(async ({ ctx, input }) => {
      await prisma.$transaction(async (transaction) => {
        const key = await transaction.apikey.findFirst({
          select: { id: true },
          where: { id: input.keyId, referenceId: ctx.access.organizationId },
        })
        if (!key) return
        await transaction.apikey.delete({ where: { id: key.id } })
        await appendAuditLog(transaction, {
          action: 'product.api_key_revoked',
          actor: getAuditActor(ctx.access.principal),
          entityId: key.id,
          entityType: 'api_key',
          organizationId: ctx.access.organizationId,
          requestId: ctx.access.requestId,
        })
      })
      return { success: true as const }
    }),
})
