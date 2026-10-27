import { optimizePreviewImageContract } from '@/lib/api/contracts/link-preview'
import { errorResponse, route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { optimizePreviewImage } from '@/lib/link-preview/fetch'
import { linkPreviewLimit } from '@/lib/link-preview/limit'

/** Fetching and re-encoding a large image takes a few seconds. */
export const maxDuration = 30

/** `GET /api/link-preview/image?url=`: download the image resized and compressed for every platform. */
export const GET = route(optimizePreviewImageContract, {
  auth: organizationAccess('artifact:read'),
  handler: async ({ access, query }) => {
    const limited = await linkPreviewLimit(access.organizationId)
    if (limited) return limited
    const result = await optimizePreviewImage(query.url)
    if (!result.ok) return errorResponse(result.status === 'blocked' ? 400 : 422, result.reason)
    return new Response(new Uint8Array(result.image), {
      headers: {
        'content-disposition': 'attachment; filename="og-image-1200x630.jpg"',
        'content-type': 'image/jpeg',
      },
    })
  },
})
