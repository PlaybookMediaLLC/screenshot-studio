import { createShellJsonRoute } from '@/lib/api/v1/route'
import { requireOrganizationPermission } from '@/lib/auth/access'
import { listWorkspaceMembers } from '@/lib/workspace/service'

export const GET = createShellJsonRoute<unknown, { organizationId: string }>({
  name: 'organizations.members',
  execute: async (request, { organizationId }) => {
    await requireOrganizationPermission(request.headers, organizationId, 'member:read')
    return { members: await listWorkspaceMembers(organizationId) }
  },
})
