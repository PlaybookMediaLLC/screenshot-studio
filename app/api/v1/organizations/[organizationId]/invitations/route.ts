import { listOrganizationInvitationsContract } from '@/lib/api/contracts/shell'
import { route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { listWorkspaceInvitations } from '@/lib/workspace/service'

/** Pending invitations to the organization. */
export const GET = route(listOrganizationInvitationsContract, {
  auth: organizationAccess('invitation:read', { scope: 'requested' }),
  handler: async ({ access }) => ({ invitations: await listWorkspaceInvitations(access) }),
})
