import { createShellJsonRoute } from '@/lib/api/v1/route'
import { requireOrganizationPermission } from '@/lib/auth/access'
import { getPlaybookBootstrap } from '@/lib/core/bootstrap'

export const GET = createShellJsonRoute<unknown, { organizationId: string }>({
  name: 'organizations.capabilities',
  execute: async (request, { organizationId }) => {
    const access = await requireOrganizationPermission(
      request.headers,
      organizationId,
      'workspace:read'
    )
    const bootstrap = await getPlaybookBootstrap(access)
    return { capabilities: bootstrap.capabilities, entitlements: bootstrap.entitlements }
  },
})
