import { validateContentBatchContract } from '@/lib/api/contracts/content-batches'
import { errorResponse, route } from '@/lib/api/route'
import { memberAccess } from '@/lib/api/route-auth'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'
import { validateContentBatch } from '@/lib/tenant/content-batches'

/** Check each item and account apart before scheduling; nothing is charged or reserved. */
export const POST = route(validateContentBatchContract, {
  auth: memberAccess({ permission: 'publish:manage', feature: 'content:drafts' }),
  handler: async ({ access, body, params }) => {
    if (!contentDraftsEnabled()) return errorResponse(404, 'Content drafts are not available.')
    return (
      (await validateContentBatch(access, params.id, body.items)) ??
      errorResponse(404, 'Batch not found.')
    )
  },
})
