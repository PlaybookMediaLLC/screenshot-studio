import {
  removeContentBatchItemContract,
  updateContentBatchItemContract,
} from '@/lib/api/contracts/content-batches'
import { errorResponse, route } from '@/lib/api/route'
import { memberAccess } from '@/lib/api/route-auth'
import { backendSDK } from '@/lib/backend/sdk'
import { updateContentBatchItem } from '@/lib/tenant/content-batches'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'

/** Change a staged item, or a drafted item's time and position. */
export const PATCH = route(updateContentBatchItemContract, {
  auth: memberAccess({ permission: 'artifact:edit', feature: 'content:drafts' }),
  handler: async ({ access, body, params }) => {
    if (!contentDraftsEnabled()) return errorResponse(404, 'Content drafts are not available.')
    return updateContentBatchItem(access, params.id, params.itemId, body)
  },
})

/** Take an item out of its batch; a draft it made stays in Write. */
export const DELETE = route(removeContentBatchItemContract, {
  auth: memberAccess({ permission: 'artifact:edit', feature: 'content:drafts' }),
  handler: async ({ access, params }) => {
    if (!contentDraftsEnabled()) return errorResponse(404, 'Content drafts are not available.')
    await backendSDK(access).removeContentBatchItem(params.id, params.itemId)
    return { removed: true as const }
  },
})
