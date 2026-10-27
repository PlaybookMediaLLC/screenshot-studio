import { refreshAnalyticsContract } from '@/lib/api/contracts/plan-analyze'
import { route, errorResponse } from '@/lib/api/route'
import { memberAccess } from '@/lib/api/route-auth'
import { backendSDK } from '@/lib/backend/sdk'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'

/** refreshAnalyticsContract: authenticated, workspace-scoped backend operation. */
export const POST = route(refreshAnalyticsContract, {
  auth: memberAccess(refreshAnalyticsContract.access),
  handler: async ({ access, params }) => {
    if (!contentDraftsEnabled()) return errorResponse(404, 'Content workspace is unavailable.')
    return await backendSDK(access).refreshAnalytics(params.id)
  },
})
