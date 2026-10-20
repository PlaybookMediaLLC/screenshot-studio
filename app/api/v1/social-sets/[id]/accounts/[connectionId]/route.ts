import {
  assignSocialSetAccountContract,
  removeSocialSetAccountContract,
} from '@/lib/api/contracts/social-sets'
import { errorResponse, route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { backendSDK } from '@/lib/backend/sdk'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'

/** Add an account that is in no set to this social set. */
export const POST = route(assignSocialSetAccountContract, {
  auth: organizationAccess('publish:manage'),
  handler: ({ access, params }) =>
    contentDraftsEnabled()
      ? backendSDK(access).assignSocialSetAccount(params.id, params.connectionId)
      : errorResponse(404, 'Social sets are not available.'),
})

/** Remove an account from this social set; its queued posts are cancelled. */
export const DELETE = route(removeSocialSetAccountContract, {
  auth: organizationAccess('publish:manage'),
  handler: ({ access, params }) =>
    contentDraftsEnabled()
      ? backendSDK(access).removeSocialSetAccount(params.id, params.connectionId)
      : errorResponse(404, 'Social sets are not available.'),
})
