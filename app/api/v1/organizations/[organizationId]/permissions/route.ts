import { createShellJsonRoute } from '@/lib/api/v1/route'
import { requireOrganizationPermission } from '@/lib/auth/access'
import { getRolePermissions } from '@/lib/auth/permissions'

export const GET = createShellJsonRoute<unknown, { organizationId: string }>({
  name: 'organizations.permissions',
  execute: async (request, { organizationId }) => {
    const access = await requireOrganizationPermission(
      request.headers,
      organizationId,
      'workspace:read'
    )
    return { permissions: getRolePermissions(access.role), role: access.role }
  },
})
