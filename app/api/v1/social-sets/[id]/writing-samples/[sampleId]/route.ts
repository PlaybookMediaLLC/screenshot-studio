import { deleteWritingSampleContract } from '@/lib/api/contracts/social-sets'
import { errorResponse, route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { backendSDK } from '@/lib/backend/sdk'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'

/** Remove a writing sample. */
export const DELETE = route(deleteWritingSampleContract, {
  auth: organizationAccess('artifact:edit'),
  handler: ({ access, params }) =>
    contentDraftsEnabled()
      ? backendSDK(access).deleteWritingSample(params.id, params.sampleId)
      : errorResponse(404, 'Social sets are not available.'),
})
