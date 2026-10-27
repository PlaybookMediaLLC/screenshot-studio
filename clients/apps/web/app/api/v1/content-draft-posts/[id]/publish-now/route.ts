import { publishQueuedDraftPostContract } from '@/lib/api/contracts/content-draft-platform'
import { errorResponse, route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'
import { publishQueuedContentDraftPost } from '@/lib/tenant/content-drafts'

/** Publish the confirmed queued snapshot, preserving its idempotency and approval. */
export const POST = route(publishQueuedDraftPostContract, {
  auth: organizationAccess('publish:manage'),
  handler: async ({ access, params }) => {
    if (!contentDraftsEnabled()) return errorResponse(404, 'Post not found.')
    const post = await publishQueuedContentDraftPost(access, params.id)
    return post ? { post } : errorResponse(404, 'Post not found.')
  },
})
