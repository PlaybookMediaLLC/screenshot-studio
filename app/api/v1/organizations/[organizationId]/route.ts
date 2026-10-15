import { createShellJsonRoute } from '@/lib/api/v1/route'
import { requireOrganizationPermission } from '@/lib/auth/access'
import { WorkspaceError } from '@/lib/workspace/errors'
import { getWorkspace } from '@/lib/workspace/service'

/**
 * Organization routes act on the session's active organization only. A shell
 * that wants another organization activates it first, so every tenant read
 * resolves through the same membership check as the web app.
 */
export const GET = createShellJsonRoute<unknown, { organizationId: string }>({
  name: 'organizations.get',
  execute: async (request, { organizationId }) => {
    const access = await requireOrganizationPermission(
      request.headers,
      organizationId,
      'workspace:read'
    )
    const organization = await getWorkspace(access)
    if (!organization) {
      throw new WorkspaceError('Workspace not found.', 404)
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
