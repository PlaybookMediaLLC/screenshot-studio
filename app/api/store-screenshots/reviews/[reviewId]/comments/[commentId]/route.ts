import { resolveCommentContract } from '@/lib/api/contracts/store-screenshots'
import { route } from '@/lib/api/route'
import { tenantAccess } from '@/lib/api/route-auth'
import { resolveReviewComment } from '@/lib/tenant/store-screenshots'

/** Resolve or reopen a review comment. */
export const PUT = route(resolveCommentContract, {
  auth: tenantAccess({ apiKeyScope: 'asset:write', permission: 'artifact:edit' }),
  handler: async ({ access, params, body }) => {
    await resolveReviewComment(access, params.reviewId, params.commentId, body.resolved)
    return { resolved: body.resolved }
  },
})
