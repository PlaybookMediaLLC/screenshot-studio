import {
  mutateDraftCommentContract,
  listDraftCommentsContract,
} from '@/lib/api/contracts/draft-comments'
import { errorResponse, route } from '@/lib/api/route'
import { tenantAccess } from '@/lib/api/route-auth'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'
import { mutateDraftComment, listDraftComments } from '@/lib/tenant/draft-comments'

/** Comment-only access for members and explicitly scoped workspace API keys. */
export const POST = route(mutateDraftCommentContract, {
  auth: tenantAccess(mutateDraftCommentContract.access),
  handler: async ({ access, body, params }) => {
    if (!contentDraftsEnabled()) return errorResponse(404, 'Content draft not found.')
    return (
      (await mutateDraftComment(access, params.id, body)) ??
      errorResponse(404, 'Content draft not found.')
    )
  },
})

/** Read and filter discussions on an authorized draft. */
export const GET = route(listDraftCommentsContract, {
  auth: tenantAccess(listDraftCommentsContract.access),
  handler: async ({ access, params, query }) => {
    if (!contentDraftsEnabled()) return errorResponse(404, 'Content draft not found.')
    return (
      (await listDraftComments(access, params.id, query)) ??
      errorResponse(404, 'Content draft not found.')
    )
  },
})
