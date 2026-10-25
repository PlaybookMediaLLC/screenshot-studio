import { validateDraftScheduleContract } from '@/lib/api/contracts/draft-batch'
import { errorResponse, route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { backendSDK } from '@/lib/backend/sdk'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'
import { prepareContentDraftSchedule } from '@/lib/tenant/content-drafts'

/** Validate a batch row using the serializer and authority of normal scheduling. */
export const POST = route(validateDraftScheduleContract, {
  auth: organizationAccess('publish:manage'),
  handler: async ({ access, params, body }) => {
    if (!contentDraftsEnabled()) return errorResponse(404, 'Content drafts are not available.')
    const input = await prepareContentDraftSchedule(access, params.id, body)
    if (!input) return errorResponse(404, 'Draft not found.')
    return backendSDK(access).validateContentDraftSchedule(params.id, input)
  },
})
