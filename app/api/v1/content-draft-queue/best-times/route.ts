import { bestPostingTimesContract } from '@/lib/api/contracts/content-draft-platform'
import { errorResponse, route } from '@/lib/api/route'
import { tenantAccess } from '@/lib/api/route-auth'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'
import { bestPostingTimes } from '@/lib/tenant/content-drafts'

/** The next good times to post, from the workspace's engagement. */
export const GET = route(bestPostingTimesContract, {
  auth: tenantAccess(bestPostingTimesContract.access),
  handler: async ({ access, query }) => {
    if (!contentDraftsEnabled()) return errorResponse(404, 'Content drafts are not available.')
    return { items: await bestPostingTimes(access, query.socialSetId) }
  },
})
