import { createShellJsonRoute } from '@/lib/api/v1/route'
import { requireOrganizationPermission } from '@/lib/auth/access'
import { getOrganizationCapabilities } from '@/lib/core/bootstrap'
import { getWorkspaceEntitlementSummary } from '@/lib/tenant/entitlements'

export const GET = createShellJsonRoute<unknown, { organizationId: string }>({
  name: 'organizations.capabilities',
  execute: async (request, { organizationId }) => {
    await requireOrganizationPermission(request.headers, organizationId, 'workspace:read')
    const [capabilities, entitlements] = await Promise.all([
      getOrganizationCapabilities(organizationId),
      getWorkspaceEntitlementSummary(organizationId),
    ])
    return { capabilities, entitlements }
  },
})
