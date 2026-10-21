import { previewMastodonInstanceContract } from '@/lib/api/contracts/social-instances'
import { errorResponse, route } from '@/lib/api/route'
import { memberAccess } from '@/lib/api/route-auth'
import { backendSDK } from '@/lib/backend/sdk'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'

/** Fetch a bounded public preview through the backend’s SSRF-safe client. */
export const GET = route(previewMastodonInstanceContract, {
  auth: memberAccess(previewMastodonInstanceContract.access),
  handler: ({ access, query }) => {
    if (!contentDraftsEnabled()) return errorResponse(404, 'Social sets are not available.')
    return backendSDK(access).previewMastodonInstance(query.server)
  },
})
