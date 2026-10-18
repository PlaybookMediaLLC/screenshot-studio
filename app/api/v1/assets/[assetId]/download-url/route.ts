import { createAssetDownloadUrlContract } from '@/lib/api/contracts/assets'
import { errorResponse, route } from '@/lib/api/route'
import { tenantAccess } from '@/lib/api/route-auth'
import { signAssetDownload } from '@/lib/tenant/assets'

/** A short-lived signed download URL for a ready asset. */
export const GET = route(createAssetDownloadUrlContract, {
  auth: tenantAccess(createAssetDownloadUrlContract.access),
  handler: async ({ access, params }) => {
    const downloadUrl = await signAssetDownload(access, params.assetId)
    return downloadUrl ? { downloadUrl } : errorResponse(404, 'Asset not found.')
  },
})
