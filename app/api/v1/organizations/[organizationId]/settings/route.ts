import { createShellJsonRoute } from '@/lib/api/v1/route'
import { requireOrganizationPermission } from '@/lib/auth/access'
import { getWorkspace } from '@/lib/workspace/service'

export const GET = createShellJsonRoute<unknown, { organizationId: string }>({
  name: 'organizations.settings',
  execute: async (request, { organizationId }) => {
    const access = await requireOrganizationPermission(
      request.headers,
      organizationId,
      'workspace:read'
    )
    const settings = (await getWorkspace(access))?.workspaceSettings
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
