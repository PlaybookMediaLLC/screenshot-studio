import { createShellJsonRoute } from '@/lib/api/v1/route'
import { requireOrganizationPermission } from '@/lib/auth/access'
import { prisma } from '@/lib/db'

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
    const organization = await prisma.organization.findUniqueOrThrow({
      select: { createdAt: true, id: true, logo: true, name: true, slug: true },
      where: { id: organizationId },
    })
    return { organization: { ...organization, role: access.role } }
  },
})
