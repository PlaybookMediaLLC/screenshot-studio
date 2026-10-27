import { copySocialSetContract } from '@/lib/api/contracts/social-sets'
import { errorResponse, route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { backendSDK } from '@/lib/backend/sdk'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'

/** Copy a set from another of your workspaces; its accounts are connected again here. */
export const POST = route(copySocialSetContract, {
  auth: organizationAccess('connection:manage'),
  handler: ({ access, body }) =>
    contentDraftsEnabled()
      ? backendSDK(access).copySocialSet(body.workspaceId, body.socialSetId)
      : errorResponse(404, 'Social sets are not available.'),
})
