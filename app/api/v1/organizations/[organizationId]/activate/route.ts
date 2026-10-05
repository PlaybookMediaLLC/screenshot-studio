import { createShellJsonRoute } from '@/lib/api/v1/route'
import { requireActiveOrganizationPermission, requireSessionAccess } from '@/lib/auth/access'
import { getPlaybookBootstrap } from '@/lib/core/bootstrap'
import { setActiveWorkspace } from '@/lib/workspace/service'

/**
 * Switch the session's active organization and return the refreshed
 * bootstrap. Membership and deletion state are checked by setActiveWorkspace,
 * the same path the web app's switcher uses.
 */
export const POST = createShellJsonRoute<unknown, { organizationId: string }>({
  name: 'organizations.activate',
  execute: async (request, { organizationId }) => {
    await setActiveWorkspace(await requireSessionAccess(request.headers), organizationId)
    return getPlaybookBootstrap(
      await requireActiveOrganizationPermission(request.headers, 'workspace:read')
    )
  },
})
