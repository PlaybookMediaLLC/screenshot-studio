import { shareSocialSetContract } from '@/lib/api/contracts/social-sets'
import { errorResponse, route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { backendSDK } from '@/lib/backend/sdk'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'

/** Share your private social set with the workspace. */
export const POST = route(shareSocialSetContract, {
  auth: organizationAccess('publish:manage'),
  handler: ({ access, params }) =>
    contentDraftsEnabled()
      ? backendSDK(access).shareSocialSet(params.id)
      : errorResponse(404, 'Social sets are not available.'),
})
