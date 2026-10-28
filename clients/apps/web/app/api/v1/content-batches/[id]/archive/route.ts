import { archiveContentBatchContract } from '@/lib/api/contracts/content-batches'
import { errorResponse, route } from '@/lib/api/route'
import { memberAccess } from '@/lib/api/route-auth'
import { backendSDK } from '@/lib/backend/sdk'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'

/** Close a batch; its drafts and scheduled posts stay. */
export const POST = route(archiveContentBatchContract, {
  auth: memberAccess({ permission: 'artifact:edit', feature: 'content:drafts' }),
  handler: async ({ access, params }) => {
    if (!contentDraftsEnabled()) return errorResponse(404, 'Content drafts are not available.')
    await backendSDK(access).archiveContentBatch(params.id)
    return { archived: true as const }
  },
})
