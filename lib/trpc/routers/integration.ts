import 'server-only'

import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import type { TenantAccessRequirement } from '@/lib/api/access-requirements'
import { searchNotionPages, listSlackChannels } from '@/lib/integrations/deliver'
import { ProviderError } from '@/lib/integrations/providers'
import { deliverySchema } from '@/lib/integrations/schema'
import {
  accessToken,
  deliverShareLink,
  disconnectIntegration,
  listIntegrations,
  providerSetup,
} from '@/lib/integrations/server'
import { router } from '../init'
import { organizationProcedure, tenantProcedure } from '../procedures'

const READ: TenantAccessRequirement = { apiKeyScope: 'artifact:read', permission: 'artifact:read' }
const USE: TenantAccessRequirement = { apiKeyScope: 'asset:write', permission: 'artifact:edit' }

/** A provider's refusal as a message the user can act on. */
async function provider<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    if (error instanceof ProviderError) {
      throw new TRPCError({
        cause: error,
        code: error.reconnect ? 'UNAUTHORIZED' : 'BAD_REQUEST',
        message: error.message,
      })
    }
    throw error
  }
}

/** Slack, Notion, and Figma connections: list, disconnect, pick targets, and deliver share links. */
export const integrationRouter = router({
  list: tenantProcedure(READ).query(async ({ ctx }) => ({
    integrations: await listIntegrations(ctx.tenant),
    setup: providerSetup(),
  })),
  disconnect: organizationProcedure('workspace:update')
    .input(z.object({ id: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      await disconnectIntegration(ctx.access, input.id)
      return { disconnected: true as const }
    }),
  slackChannels: tenantProcedure(USE)
    .input(z.object({ integrationId: z.string().cuid() }))
    .query(({ ctx, input }) =>
      provider(async () => {
        const { token } = await accessToken(ctx.tenant, input.integrationId)
        return { channels: await listSlackChannels(token) }
      })
    ),
  notionPages: tenantProcedure(USE)
    .input(
      z.object({ integrationId: z.string().cuid(), query: z.string().trim().max(200).default('') })
    )
    .query(({ ctx, input }) =>
      provider(async () => {
        const { token } = await accessToken(ctx.tenant, input.integrationId)
        return { pages: await searchNotionPages(token, input.query) }
      })
    ),
  deliver: tenantProcedure(USE)
    .input(deliverySchema)
    .mutation(({ ctx, input }) => provider(() => deliverShareLink(ctx.tenant, input))),
})
