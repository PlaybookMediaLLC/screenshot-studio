import { draftBatchTimesContract } from '@/lib/api/contracts/draft-batch'
import { errorResponse, route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { backendSDK } from '@/lib/backend/sdk'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'

/** Calculate every queue/Spread time without publishing or reserving a slot. */
export const POST = route(draftBatchTimesContract, {
  auth: organizationAccess('artifact:read'),
  handler: async ({ access, body }) => {
    if (!contentDraftsEnabled()) return errorResponse(404, 'Content drafts are not available.')
    return backendSDK(access).previewDraftBatchTimes(body)
  },
})
