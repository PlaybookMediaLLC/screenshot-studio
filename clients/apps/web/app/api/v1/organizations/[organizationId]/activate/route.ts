import { activateOrganizationContract } from '@/lib/api/contracts/shell'
import { route } from '@/lib/api/route'
import { sessionAccess } from '@/lib/api/route-auth'
import { requireActiveOrganizationPermission } from '@/lib/auth/access'
import { getPlaybookBootstrap } from '@/lib/core/bootstrap'
import { setActiveWorkspace } from '@/lib/workspace/service'

/**
 * Switch the session's active organization and return the refreshed
 * bootstrap. Membership and deletion state are checked by setActiveWorkspace,
 * the same path the web app's switcher uses.
 */
export const POST = route(activateOrganizationContract, {
  auth: sessionAccess,
  handler: async ({ access, params, request }) => {
    await setActiveWorkspace(access, params.organizationId)
    return getPlaybookBootstrap(
      await requireActiveOrganizationPermission(request.headers, 'workspace:read')
    )
  },
})
