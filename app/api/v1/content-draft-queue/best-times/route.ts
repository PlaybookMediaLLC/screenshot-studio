import { bestPostingTimesContract } from '@/lib/api/contracts/content-draft-platform'
import { errorResponse, route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'
import { bestPostingTimes } from '@/lib/tenant/content-drafts'

/** The next good times to post, from the workspace's engagement. */
export const GET = route(bestPostingTimesContract, {
  auth: organizationAccess('artifact:read'),
  handler: async ({ access }) => {
    if (!contentDraftsEnabled()) return errorResponse(404, 'Content drafts are not available.')
    return { items: await bestPostingTimes(access) }
  },
})
