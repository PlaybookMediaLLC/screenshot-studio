import { createReviewContract, listReviewsContract } from '@/lib/api/contracts/store-screenshots'
import { route } from '@/lib/api/route'
import { tenantAccess } from '@/lib/api/route-auth'
import { storeScreenshotsErrorResponse } from '@/lib/api/store-screenshots-errors'
import { createReview, listReviews } from '@/lib/tenant/store-screenshots'

/** Reviews of one project, with links (null once revoked) and comments. */
export const GET = route(listReviewsContract, {
  auth: tenantAccess({ apiKeyScope: 'artifact:read', permission: 'artifact:read' }),
  handler: async ({ access, query, request }) => {
    try {
      return { reviews: await listReviews(access, query.projectId, request.nextUrl.origin) }
    } catch (cause) {
      return storeScreenshotsErrorResponse(cause)
    }
  },
})

/** Create a shareable review from slide images stored with the images route. */
export const POST = route(createReviewContract, {
  auth: tenantAccess({ apiKeyScope: 'asset:write', permission: 'artifact:edit' }),
  handler: async ({ access, body, request }) => {
    try {
      return await createReview(access, body, request.nextUrl.origin)
    } catch (cause) {
      return storeScreenshotsErrorResponse(cause)
    }
  },
})
