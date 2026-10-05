import { createShellJsonRoute } from '@/lib/api/v1/route'
import { requireOrganizationPermission } from '@/lib/auth/access'
import { prisma } from '@/lib/db'

export const GET = createShellJsonRoute<unknown, { organizationId: string }>({
  name: 'organizations.settings',
  execute: async (request, { organizationId }) => {
    await requireOrganizationPermission(request.headers, organizationId, 'workspace:read')
    const settings = await prisma.workspaceSettings.findUnique({
      select: { defaultPublishTime: true, description: true, locale: true, timeZone: true },
      where: { organizationId },
    })
    return {
      settings: settings ?? {
        defaultPublishTime: '09:00',
        description: null,
        locale: 'en',
        timeZone: 'UTC',
      },
    }
  },
})
