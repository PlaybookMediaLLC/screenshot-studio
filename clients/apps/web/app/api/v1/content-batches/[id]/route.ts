import { getContentBatchContract } from '@/lib/api/contracts/content-batches'
import { errorResponse, route } from '@/lib/api/route'
import { memberAccess } from '@/lib/api/route-auth'
import { getContentBatch } from '@/lib/tenant/content-batches'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'

/** A batch with every item, its media, its draft and that draft's posts. */
export const GET = route(getContentBatchContract, {
  auth: memberAccess({ permission: 'artifact:read', feature: 'content:drafts' }),
  handler: async ({ access, params }) => {
    if (!contentDraftsEnabled()) return errorResponse(404, 'Content drafts are not available.')
    return (await getContentBatch(access, params.id)) ?? errorResponse(404, 'Batch not found.')
  },
})
