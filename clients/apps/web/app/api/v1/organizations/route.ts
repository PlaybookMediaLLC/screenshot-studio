import { listOrganizationsContract } from '@/lib/api/contracts/shell'
import { route } from '@/lib/api/route'
import { sessionAccess } from '@/lib/api/route-auth'
import { listWorkspaces } from '@/lib/workspace/service'

/** The organizations the signed-in user belongs to. */
export const GET = route(listOrganizationsContract, {
  auth: sessionAccess,
  handler: async ({ access }) => ({ organizations: await listWorkspaces(access) }),
})
