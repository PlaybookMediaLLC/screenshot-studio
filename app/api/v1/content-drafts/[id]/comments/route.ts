import { mutateDraftCommentContract } from '@/lib/api/contracts/draft-comments'
import { errorResponse, route } from '@/lib/api/route'
import { memberAccess } from '@/lib/api/route-auth'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'
import { mutateDraftComment } from '@/lib/tenant/draft-comments'

/** Comment-only access for current members, including read-only members. */
export const POST = route(mutateDraftCommentContract, {
  auth: memberAccess(mutateDraftCommentContract.access),
  handler: async ({ access, body, params }) => {
    if (!contentDraftsEnabled()) return errorResponse(404, 'Content draft not found.')
    return (
      (await mutateDraftComment(access, params.id, body)) ??
      errorResponse(404, 'Content draft not found.')
    )
  },
})
