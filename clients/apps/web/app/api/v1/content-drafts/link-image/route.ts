import { draftLinkImageContract } from '@/lib/api/contracts/draft-media'
import { errorResponse, route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'
import { readLinkImage } from '@/lib/content-drafts/link-image'
import { linkPreviewLimit } from '@/lib/link-preview/limit'
import { storeGeneratedAsset } from '@/lib/tenant/assets'

/** Explicitly ingest a discovered image through the existing tenant asset service. */
export const POST = route(draftLinkImageContract, {
  auth: organizationAccess('artifact:edit'),
  handler: async ({ access, body }) => {
    if (!contentDraftsEnabled()) return errorResponse(404, 'Content drafts are not available.')
    const limited = await linkPreviewLimit(access.organizationId)
    if (limited) return limited
    const image = await readLinkImage(body.url).catch(() => null)
    if (!image)
      return errorResponse(
        422,
        'This page image could not be attached. Choose a public page with a static image under 20 MB.'
      )
    const stored = await storeGeneratedAsset(access, {
      ...image,
      classification: 'input',
      contentType: 'image/png',
      fileName: 'link-image.png',
    })
    return {
      assetId: stored.id,
      sourceUrl: image.sourceUrl,
      width: image.width,
      height: image.height,
    }
  },
})
