import { sharedDraftImageContract } from '@/lib/api/contracts/content-draft-platform'
import { getClientIdentifier } from '@/lib/api/client-identity'
import { errorResponse, route } from '@/lib/api/route'
import { publicAccess } from '@/lib/api/route-auth'
import { serviceBackend } from '@/lib/backend/sdk'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'
import { createAssetThumbnail } from '@/lib/workspace/asset-thumbnail'
import { checkRateLimit } from '@/lib/rate-limit'

/** Share-token authorization is checked before every image response, including revocation. */
export const GET = route(sharedDraftImageContract, {
  auth: publicAccess,
  handler: async ({ params, request }) => {
    if (!contentDraftsEnabled()) return errorResponse(404, 'This draft is no longer shared.')
    const limit = await checkRateLimit(
      `draft-share-image:${getClientIdentifier(request.headers)}`,
      { maxRequests: 60, windowMs: 60_000, name: 'draft-share-image' }
    )
    if (!limit.allowed) return errorResponse(429, 'Too many preview requests.')
    const original = await serviceBackend().readSharedDraftImage(params.token)
    const thumbnail = await createAssetThumbnail(original)
    return new Response(new Uint8Array(thumbnail), {
      headers: {
        'content-type': 'image/webp',
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
      },
    })
  },
})
