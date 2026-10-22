import { BackendSDKError } from 'screenshot-studio-backend-sdk'
import { getRedisClient } from '@/lib/redis'
import { cachedThumbnail, thumbnailKey } from '@/lib/workspace/thumbnail-cache'
import { NextResponse } from 'next/server'
import { backendSDK, orNull } from '@/lib/backend/sdk'
import { createAssetThumbnail } from '@/lib/workspace/asset-thumbnail'
import { assetContentContract } from '@/lib/api/contracts/assets'
import { errorResponse, route } from '@/lib/api/route'
import { tenantAccess } from '@/lib/api/route-auth'
import { signAssetDownload } from '@/lib/tenant/assets'

class InvalidThumbnailError extends Error {}

/** Serves a small private preview or redirects to a fresh original download URL. */
export const GET = route(assetContentContract, {
  auth: tenantAccess({ apiKeyScope: 'artifact:read', permission: 'artifact:read' }),
  handler: async ({ access, params, query }) => {
    if (query.variant === 'thumbnail') {
      try {
        const thumbnail = await cachedThumbnail(
          thumbnailKey(access.organizationId, params.assetId),
          async () => {
            // Ownership, deletion, and current permissions are checked even on cache hits.
            if (!(await signAssetDownload(access, params.assetId))) {
              throw new BackendSDKError('Asset not found.', 404)
            }
          },
          async () => {
            const body = await orNull(backendSDK(access).readAsset(params.assetId))
            if (!body) throw new BackendSDKError('Asset not found.', 404)
            try {
              return await createAssetThumbnail(body)
            } catch {
              throw new InvalidThumbnailError('Preview unavailable for this asset.')
            }
          },
          async () => (await getRedisClient()).withCommandOptions({ timeout: 1_000 })
        )
        return new Response(new Uint8Array(thumbnail), {
          headers: { 'content-type': 'image/webp', 'cache-control': 'private, no-store' },
        })
      } catch (error) {
        if (error instanceof InvalidThumbnailError) return errorResponse(422, error.message)
        throw error
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
