import 'server-only'

import { z } from 'zod'
import {
  deleteGitHubConnection,
  getGitHubAppSettings,
  listGitHubConnections,
  listGitHubRepositories,
} from '@/lib/tenant/github'
import { router } from '../init'
import { organizationProcedure } from '../procedures'

const connectionInput = z.object({ connectionId: z.string().regex(/^[a-z0-9]{10,32}$/) })

/** Connecting GitHub App installations and choosing repositories, for workspace admins. */
export const githubRouter = router({
  connections: organizationProcedure('workspace:update').query(async ({ ctx }) => ({
    configured: getGitHubAppSettings() !== null,
    connections: getGitHubAppSettings() ? await listGitHubConnections(ctx.access) : [],
  })),
  disconnect: organizationProcedure('workspace:update')
    .input(connectionInput)
    .mutation(async ({ ctx, input }) => deleteGitHubConnection(ctx.access, input.connectionId)),
  repositories: organizationProcedure('workspace:update')
    .input(connectionInput)
    .query(async ({ ctx, input }) => ({
      repositories: await listGitHubRepositories(ctx.access, input.connectionId),
    })),
})
