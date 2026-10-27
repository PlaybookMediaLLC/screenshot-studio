import {
  updateAnalyticsSettingsContract,
  analyticsSettingsSchema,
} from '@/lib/api/contracts/plan-analyze'
import { route, errorResponse } from '@/lib/api/route'
import { memberAccess } from '@/lib/api/route-auth'
import { backendSDK } from '@/lib/backend/sdk'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'

/** updateAnalyticsSettingsContract: authenticated, workspace-scoped backend operation. */
export const PUT = route(updateAnalyticsSettingsContract, {
  auth: memberAccess(updateAnalyticsSettingsContract.access),
  handler: async ({ access, params, body }) => {
    if (!contentDraftsEnabled()) return errorResponse(404, 'Content workspace is unavailable.')
    return analyticsSettingsSchema.parse(
      await backendSDK(access).updateAnalyticsSettings(params.id, body)
    )
  },
})
