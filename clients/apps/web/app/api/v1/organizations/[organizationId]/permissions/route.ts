import { getOrganizationPermissionsContract } from '@/lib/api/contracts/shell'
import { route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { getRolePermissions } from '@/lib/auth/permissions'

/** The caller's role in the organization and the permissions it grants. */
export const GET = route(getOrganizationPermissionsContract, {
  auth: organizationAccess('workspace:read', { scope: 'requested' }),
  handler: async ({ access }) => ({
    permissions: getRolePermissions(access.role),
    role: access.role,
  }),
})
