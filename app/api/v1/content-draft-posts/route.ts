import { listCalendarPostsContract } from '@/lib/api/contracts/content-draft-platform'
import { errorResponse, route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'
import { listContentDraftPostsBetween } from '@/lib/tenant/content-drafts'

/** Draft posts due in a window, for the calendar and the queue. */
export const GET = route(listCalendarPostsContract, {
  auth: organizationAccess('artifact:read'),
  handler: async ({ access, query }) => {
    if (!contentDraftsEnabled()) return errorResponse(404, 'Content drafts are not available.')
    return {
      items: await listContentDraftPostsBetween(access, query.from, query.to, query.socialSetId),
    }
  },
})
