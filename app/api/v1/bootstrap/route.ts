import { createShellJsonRoute } from '@/lib/api/v1/route'
import { requireActiveOrganizationPermission } from '@/lib/auth/access'
import { getPlaybookBootstrap } from '@/lib/core/bootstrap'

export const GET = createShellJsonRoute({
  name: 'bootstrap',
  execute: async (request) =>
    getPlaybookBootstrap(
      await requireActiveOrganizationPermission(request.headers, 'workspace:read')
    ),
})
