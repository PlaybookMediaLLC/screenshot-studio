import { listCopyableSocialSetsContract } from '@/lib/api/contracts/social-sets'
import { errorResponse, route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { backendSDK } from '@/lib/backend/sdk'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'

/** Social sets of your other workspaces that can be copied here. */
export const GET = route(listCopyableSocialSetsContract, {
  auth: organizationAccess('publish:manage'),
  handler: ({ access }) =>
    contentDraftsEnabled()
      ? backendSDK(access).listCopyableSocialSets()
      : errorResponse(404, 'Social sets are not available.'),
})
