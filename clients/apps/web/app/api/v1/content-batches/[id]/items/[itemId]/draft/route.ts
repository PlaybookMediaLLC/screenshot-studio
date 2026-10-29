import { createContentBatchItemDraftContract } from '@/lib/api/contracts/content-batches'
import { errorResponse, route } from '@/lib/api/route'
import { memberAccess } from '@/lib/api/route-auth'
import { createContentBatchItemDraft } from '@/lib/tenant/content-batches'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'

/** Save an item as its draft, keyed by the item, so a retry returns the same draft. */
export const POST = route(createContentBatchItemDraftContract, {
  auth: memberAccess({ permission: 'artifact:edit', feature: 'content:drafts' }),
  handler: async ({ access, body, params }) => {
    if (!contentDraftsEnabled()) return errorResponse(404, 'Content drafts are not available.')
    return createContentBatchItemDraft(access, params.id, params.itemId, body)
  },
})
