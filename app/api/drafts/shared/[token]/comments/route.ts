import { getClientIdentifier } from '@/lib/api/client-identity'
import { addGuestCommentContract } from '@/lib/api/contracts/content-draft-platform'
import { STORE_REVIEW_COMMENT_RATE_LIMIT } from '@/lib/api/rate-limit-policy'
import { errorResponse, route } from '@/lib/api/route'
import { publicAccess } from '@/lib/api/route-auth'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'
import { checkRateLimit } from '@/lib/rate-limit'
import { addGuestComment } from '@/lib/tenant/content-drafts'

/**
 * A guest's comment through a draft's share link. The link's token is the
 * credential; the backend finds nothing once the link is off. Rate limited per
 * client and link, so a leaked link cannot flood a draft.
 */
export const POST = route(addGuestCommentContract, {
  auth: publicAccess,
  handler: async ({ body, params, request }) => {
    if (!contentDraftsEnabled()) return errorResponse(404, 'This draft is no longer shared.')
    const limit = await checkRateLimit(
      `draft-share:${getClientIdentifier(request.headers)}:${params.token.slice(-24)}`,
      STORE_REVIEW_COMMENT_RATE_LIMIT
    )
    if (!limit.allowed) return errorResponse(429, 'Too many comments. Try again in a few minutes.')
    return (
      (await addGuestComment(params.token, body)) ??
      errorResponse(404, 'This draft is no longer shared.')
    )
  },
})
