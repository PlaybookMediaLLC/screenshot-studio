import { completeAssetUploadContract } from '@/lib/api/contracts/assets'
import { errorResponse, route } from '@/lib/api/route'
import { tenantAccess } from '@/lib/api/route-auth'
import { completeAssetUpload } from '@/lib/tenant/assets'

/** Mark an uploaded asset ready, optionally checking its SHA-256. */
export const POST = route(completeAssetUploadContract, {
  auth: tenantAccess({ apiKeyScope: 'asset:write', permission: 'artifact:edit' }),
  handler: async ({ access, body, params }) => {
    const asset = await completeAssetUpload(access, params.assetId, body.sha256)
    return asset ? { asset } : errorResponse(404, 'Asset not found.')
  },
})
