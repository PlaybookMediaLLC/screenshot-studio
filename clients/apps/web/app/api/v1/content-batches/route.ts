import {
  createContentBatchContract,
  listContentBatchesContract,
} from '@/lib/api/contracts/content-batches'
import { errorResponse, route } from '@/lib/api/route'
import { memberAccess } from '@/lib/api/route-auth'
import { createContentBatch, listContentBatches } from '@/lib/tenant/content-batches'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'

/** The open bulk batches in the sets this member can see. */
export const GET = route(listContentBatchesContract, {
  auth: memberAccess({ permission: 'artifact:read', feature: 'content:drafts' }),
  handler: async ({ access }) => {
    if (!contentDraftsEnabled()) return errorResponse(404, 'Content drafts are not available.')
    return listContentBatches(access)
  },
})

/** Start a durable bulk batch in a social set. */
export const POST = route(createContentBatchContract, {
  auth: memberAccess({ permission: 'artifact:edit', feature: 'content:drafts' }),
  handler: async ({ access, body }) => {
    if (!contentDraftsEnabled()) return errorResponse(404, 'Content drafts are not available.')
    return createContentBatch(access, body)
  },
})
