import { setAssetAltTextContract } from '@/lib/api/contracts/assets'
import { errorResponse, route } from '@/lib/api/route'
import { tenantAccess } from '@/lib/api/route-auth'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'
import { setAssetAltText } from '@/lib/tenant/assets'

const notFound = () => errorResponse(404, 'Asset not found.')

/** Describe an image; the description is posted with it as alt text. */
export const PUT = route(setAssetAltTextContract, {
  auth: tenantAccess(setAssetAltTextContract.access),
  handler: async ({ access, body, params }) => {
    if (!contentDraftsEnabled()) return notFound()
    return (await setAssetAltText(access, params.assetId, body.altText)) ?? notFound()
  },
})
