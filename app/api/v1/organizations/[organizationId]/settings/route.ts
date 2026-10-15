import { getOrganizationSettingsContract } from '@/lib/api/contracts/shell'
import { route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { getWorkspace } from '@/lib/workspace/service'

/** The organization's settings, or the defaults when none are saved. */
export const GET = route(getOrganizationSettingsContract, {
  auth: organizationAccess('workspace:read', { scope: 'requested' }),
  handler: async ({ access }) => ({
    settings: (await getWorkspace(access))?.workspaceSettings ?? {
      defaultPublishTime: '09:00',
      description: null,
      locale: 'en',
      timeZone: 'UTC',
    },
  }),
})
