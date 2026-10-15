import { getOrganizationCapabilitiesContract } from '@/lib/api/contracts/shell'
import { route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { getPlaybookBootstrap } from '@/lib/core/bootstrap'

/** The organization's enabled capabilities and plan entitlements. */
export const GET = route(getOrganizationCapabilitiesContract, {
  auth: organizationAccess('workspace:read', { scope: 'requested' }),
  handler: async ({ access }) => {
    const { capabilities, entitlements } = await getPlaybookBootstrap(access)
    return { capabilities, entitlements }
  },
})
