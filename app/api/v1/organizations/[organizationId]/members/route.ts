import { listOrganizationMembersContract } from '@/lib/api/contracts/shell'
import { route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { listWorkspaceMembers } from '@/lib/workspace/service'

/** Members of the organization. */
export const GET = route(listOrganizationMembersContract, {
  auth: organizationAccess('member:read', { scope: 'requested' }),
  handler: async ({ access }) => ({ members: await listWorkspaceMembers(access) }),
})
