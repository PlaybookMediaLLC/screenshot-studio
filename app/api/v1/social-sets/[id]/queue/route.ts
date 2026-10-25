import { updateSocialSetQueueContract } from '@/lib/api/contracts/social-set-queue'
import { errorResponse, route } from '@/lib/api/route'
import { tenantAccess } from '@/lib/api/route-auth'
import { backendSDK } from '@/lib/backend/sdk'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'

/** Save queue defaults; never changes an existing post or approval requirement. */
export const PATCH = route(updateSocialSetQueueContract, {
  auth: tenantAccess(updateSocialSetQueueContract.access),
  handler: ({ access, body, params }) =>
    contentDraftsEnabled()
      ? backendSDK(access).updateSocialSetQueue(params.id, body)
      : errorResponse(404, 'Social sets are not available.'),
})
