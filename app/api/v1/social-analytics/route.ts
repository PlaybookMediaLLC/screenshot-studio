import { socialAnalyticsContract } from '@/lib/api/contracts/social-analytics'
import { errorResponse, route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { backendSDK } from '@/lib/backend/sdk'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'

/** Stored provider observations, with identical tenant and set visibility gates. */
export const GET = route(socialAnalyticsContract, {
  auth: organizationAccess('artifact:read'),
  handler: async ({ access, query }) => {
    if (!contentDraftsEnabled()) return errorResponse(404, 'Content drafts are not available.')
    return backendSDK(access).listSocialAnalytics(query)
  },
})
