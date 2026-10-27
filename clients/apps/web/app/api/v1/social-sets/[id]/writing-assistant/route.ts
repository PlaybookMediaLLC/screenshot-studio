import { updateWritingAssistantContract } from '@/lib/api/contracts/social-sets'
import { errorResponse, route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { backendSDK } from '@/lib/backend/sdk'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'

/** Create, turn off or on, or edit the style guide of the Writing Assistant. */
export const PUT = route(updateWritingAssistantContract, {
  auth: organizationAccess('artifact:edit'),
  handler: ({ access, body, params }) =>
    contentDraftsEnabled()
      ? backendSDK(access).updateWritingAssistant(params.id, body)
      : errorResponse(404, 'Social sets are not available.'),
})
