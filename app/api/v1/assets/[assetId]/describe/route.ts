import { describeAssetContract } from '@/lib/api/contracts/assets'
import { route, errorResponse } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { backendSDK, orNull } from '@/lib/backend/sdk'
import { aiUnavailable } from '@/lib/write/ai-route'
import { describeDraftImage } from '@/lib/write/describe-image'
import { createAssetThumbnail } from '@/lib/workspace/asset-thumbnail'

/** Suggest editable alt text after workspace ownership and AI policy checks. */
export const POST = route(describeAssetContract, {
  auth: organizationAccess('artifact:edit'),
  handler: async ({ access, params }) => {
    const unavailable = await aiUnavailable(access)
    if (unavailable) return unavailable
    const body = await orNull(backendSDK(access).readAsset(params.assetId))
    if (!body) return errorResponse(404, 'Asset not found.')
    let image: Uint8Array
    try {
      image = await createAssetThumbnail(body)
    } catch {
      return errorResponse(422, 'Choose a PNG, JPEG, WebP, or GIF image that can be previewed.')
    }
    return describeDraftImage(access, image)
  },
})
