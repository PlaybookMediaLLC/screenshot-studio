import { reviewImageContract } from '@/lib/api/contracts/store-screenshots'
import { errorResponse, route } from '@/lib/api/route'
import { tenantAccess } from '@/lib/api/route-auth'
import {
  decodeBase64Image,
  storeScreenshotsErrorResponse,
} from '@/lib/api/store-screenshots-errors'
import { storeReviewImage } from '@/lib/tenant/store-screenshots'

/** Store one rendered slide (JPEG) for a review. Source screenshots are never uploaded. */
export const POST = route(reviewImageContract, {
  auth: tenantAccess({ apiKeyScope: 'asset:write', permission: 'artifact:edit' }),
  handler: async ({ access, body }) => {
    const bytes = decodeBase64Image(body.image)
    if (!bytes || bytes.length > 6 * 1024 * 1024)
      return errorResponse(400, 'The slide image is not a valid JPEG under 6 MB.')
    try {
      return {
        assetId: await storeReviewImage(access, {
          bytes,
          width: body.width,
          height: body.height,
          name: body.name,
        }),
      }
    } catch (cause) {
      return storeScreenshotsErrorResponse(cause)
    }
  },
})
