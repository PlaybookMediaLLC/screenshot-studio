import { getAnalyticsContract, analyticsReportSchema } from '@/lib/api/contracts/plan-analyze'
import { route, errorResponse } from '@/lib/api/route'
import { tenantAccess } from '@/lib/api/route-auth'
import { backendSDK } from '@/lib/backend/sdk'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'

/** getAnalyticsContract: authenticated, workspace-scoped backend operation. */
export const GET = route(getAnalyticsContract, {
  auth: tenantAccess(getAnalyticsContract.access),
  handler: async ({ access, params, query }) => {
    if (!contentDraftsEnabled()) return errorResponse(404, 'Content workspace is unavailable.')
    return analyticsReportSchema.parse(await backendSDK(access).getAnalytics(params.id, query))
  },
})
