import { beginBlueskyConnectionContract } from '@/lib/api/contracts/bluesky-connections'
import { errorResponse, route } from '@/lib/api/route'
import { memberAccess } from '@/lib/api/route-auth'
import { backendSDK } from '@/lib/backend/sdk'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'

/** Create a scoped credential attempt without storing the password or an empty set. */
export const POST = route(beginBlueskyConnectionContract, {
  auth: memberAccess(beginBlueskyConnectionContract.access),
  handler: async ({ access, body }) => {
    if (!contentDraftsEnabled()) return errorResponse(404, 'Social sets are not available.')
    return backendSDK(access).beginBlueskyConnection(body)
  },
})
