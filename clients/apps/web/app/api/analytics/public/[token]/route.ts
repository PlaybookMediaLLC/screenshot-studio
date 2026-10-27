import { analyticsReportSchema, publicAnalyticsContract } from '@/lib/api/contracts/plan-analyze'
import { route, errorResponse } from '@/lib/api/route'
import { publicAccess } from '@/lib/api/route-auth'
import { serviceBackend, orNull } from '@/lib/backend/sdk'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'

/** Revocable public analytics, excluded from all application and browser caches. */
export const GET = route(publicAnalyticsContract, {
  auth: publicAccess,
  handler: async ({ params, query }) => {
    if (!contentDraftsEnabled()) return errorResponse(404, 'Analytics is no longer shared.')
    const report = await orNull(serviceBackend().getPublicAnalytics(params.token, query))
    if (!report) return errorResponse(404, 'Analytics is no longer shared.')
    return Response.json(analyticsReportSchema.parse(report), {
      headers: { 'Cache-Control': 'no-store, max-age=0', 'X-Robots-Tag': 'noindex, nofollow' },
    })
  },
})
