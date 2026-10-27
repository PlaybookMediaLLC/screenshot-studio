import { revokeReviewContract } from '@/lib/api/contracts/store-screenshots'
import { route } from '@/lib/api/route'
import { tenantAccess } from '@/lib/api/route-auth'
import { revokeReview } from '@/lib/tenant/store-screenshots'

/** Turn off a review link. Every copy of the link stops working. */
export const POST = route(revokeReviewContract, {
  auth: tenantAccess({ apiKeyScope: 'asset:write', permission: 'artifact:edit' }),
  handler: async ({ access, params }) => {
    await revokeReview(access, params.reviewId)
    return { revoked: true }
  },
})
