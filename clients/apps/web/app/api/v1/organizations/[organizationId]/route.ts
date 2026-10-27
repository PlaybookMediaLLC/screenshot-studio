import { getOrganizationContract } from '@/lib/api/contracts/shell'
import { errorResponse, route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { getWorkspace } from '@/lib/workspace/service'

/**
 * Organization routes act on the session's active organization only. A shell
 * that wants another organization activates it first, so every tenant read
 * resolves through the same membership check as the web app.
 */
export const GET = route(getOrganizationContract, {
  auth: organizationAccess('workspace:read', { scope: 'requested' }),
  handler: async ({ access }) => {
    const organization = await getWorkspace(access)
    if (!organization) {
      return errorResponse(404, 'Workspace not found.')
    }
    return {
      organization: {
        createdAt: organization.createdAt,
        id: organization.id,
        logo: organization.logo,
        name: organization.name,
        role: access.role,
        slug: organization.slug,
      },
    }
  },
})
