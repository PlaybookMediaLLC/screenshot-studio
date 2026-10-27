import { BackendSDKError } from 'screenshot-studio-backend-sdk'
import { getClientIdentifier } from '@/lib/api/client-identity'
import { linkCommentContract } from '@/lib/api/contracts/store-screenshots'
import { STORE_REVIEW_COMMENT_RATE_LIMIT } from '@/lib/api/rate-limit-policy'
import { errorResponse, route } from '@/lib/api/route'
import { publicAccess } from '@/lib/api/route-auth'
import { checkRateLimit } from '@/lib/rate-limit'
import { commentOnSharedReview, StoreScreenshotsError } from '@/lib/tenant/store-screenshots'

/**
 * Comment through a review link. The signed link is the credential; the
 * backend re-checks its token id and revocation. Rate limited per client
 * and link so a leaked link cannot flood a workspace.
 */
export const POST = route(linkCommentContract, {
  auth: publicAccess,
  handler: async ({ body, params, request }) => {
    const limit = await checkRateLimit(
      `${getClientIdentifier(request.headers)}:${params.token.slice(-24)}`,
      STORE_REVIEW_COMMENT_RATE_LIMIT
    )
    if (!limit.allowed) return errorResponse(429, 'Too many comments. Try again in a few minutes.')
    try {
      return await commentOnSharedReview(params.token, body)
    } catch (cause) {
      if (cause instanceof StoreScreenshotsError) return errorResponse(cause.status, cause.message)
      if (cause instanceof BackendSDKError && (cause.status === 404 || cause.status === 400)) {
        return errorResponse(
          cause.status === 404 ? 404 : 400,
          cause.status === 404
            ? 'This review is no longer available.'
            : 'The comment could not be saved.'
        )
      }
      throw cause
    }
  },
})
