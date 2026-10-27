import { refreshDraftPostMetricsContract } from '@/lib/api/contracts/content-draft-platform'
import { errorResponse, route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'
import { refreshContentDraftPostMetrics } from '@/lib/tenant/content-drafts'

/** Read a live post's engagement from its platform now. */
export const POST = route(refreshDraftPostMetricsContract, {
  auth: organizationAccess('artifact:read'),
  handler: async ({ access, params }) => {
    if (!contentDraftsEnabled()) return errorResponse(404, 'Post not found.')
    const post = await refreshContentDraftPostMetrics(access, params.id)
    return post ? { post } : errorResponse(404, 'Post not found.')
  },
})
