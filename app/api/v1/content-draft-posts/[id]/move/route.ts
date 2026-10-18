import { moveDraftPostContract } from '@/lib/api/contracts/content-draft-platform'
import { errorResponse, route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'
import { moveContentDraftPost } from '@/lib/tenant/content-drafts'

/** Move a queued draft post to a new time (the calendar's drag and drop). */
export const POST = route(moveDraftPostContract, {
  auth: organizationAccess('publish:manage'),
  handler: async ({ access, body, params }) => {
    if (!contentDraftsEnabled()) return errorResponse(404, 'Post not found.')
    const post = await moveContentDraftPost(access, params.id, body.scheduledFor)
    return post ? { post } : errorResponse(404, 'Post not found.')
  },
})
