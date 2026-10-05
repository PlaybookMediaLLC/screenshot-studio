import { createShellJsonRoute } from '@/lib/api/v1/route'
import { requireSessionAccess } from '@/lib/auth/access'
import { listWorkspaces } from '@/lib/workspace/service'

export const GET = createShellJsonRoute({
  name: 'organizations.list',
  execute: async (request) => ({
    organizations: await listWorkspaces(await requireSessionAccess(request.headers)),
  }),
})
