import { getBootstrapContract } from '@/lib/api/contracts/shell'
import { route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { getPlaybookBootstrap } from '@/lib/core/bootstrap'

/** Everything a shell needs to render the active organization. */
export const GET = route(getBootstrapContract, {
  auth: organizationAccess('workspace:read'),
  handler: async ({ access }) => getPlaybookBootstrap(access),
})
