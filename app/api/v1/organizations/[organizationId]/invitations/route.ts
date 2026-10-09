import { createShellJsonRoute } from '@/lib/api/v1/route'
import { requireOrganizationPermission } from '@/lib/auth/access'
import { listWorkspaceInvitations } from '@/lib/workspace/service'

export const GET = createShellJsonRoute<unknown, { organizationId: string }>({
  name: 'organizations.invitations',
  execute: async (request, { organizationId }) => {
    await requireOrganizationPermission(request.headers, organizationId, 'invitation:read')
    return { invitations: await listWorkspaceInvitations(organizationId) }
  },
})
