import { NextResponse } from 'next/server'
import { backendSDK, orNull } from '@/lib/backend/sdk'
import { createAssetThumbnail } from '@/lib/workspace/asset-thumbnail'
import { assetContentContract } from '@/lib/api/contracts/assets'
import { errorResponse, route } from '@/lib/api/route'
import { tenantAccess } from '@/lib/api/route-auth'
import { signAssetDownload } from '@/lib/tenant/assets'

/** Serves a small private preview or redirects to a fresh original download URL. */
export const GET = route(assetContentContract, {
  auth: tenantAccess({ apiKeyScope: 'artifact:read', permission: 'artifact:read' }),
  handler: async ({ access, params, query }) => {
    if (query.variant === 'thumbnail') {
      const body = await orNull(backendSDK(access).readAsset(params.assetId))
      if (!body) return errorResponse(404, 'Asset not found.')
      try {
        const thumbnail = await createAssetThumbnail(body)
        return new Response(new Uint8Array(thumbnail), {
          headers: { 'content-type': 'image/webp', 'cache-control': 'private, no-store' },
        })
      } catch {
        return errorResponse(422, 'Preview unavailable for this asset.')
      }
    }
    const downloadUrl = await signAssetDownload(access, params.assetId)
    if (!downloadUrl) return errorResponse(404, 'Asset not found.')
    const response = NextResponse.redirect(downloadUrl, 302)
    // The signed URL expires; never let a cache keep the redirect.
    response.headers.set('cache-control', 'private, no-store')
    return response
  },
})
