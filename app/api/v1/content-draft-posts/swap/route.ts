import { swapDraftPostsContract } from '@/lib/api/contracts/content-draft-platform'
import { route, errorResponse } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { backendSDK } from '@/lib/backend/sdk'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'

/** Exchange two queue positions with the same human publishing authority as moving a post. */
export const POST = route(swapDraftPostsContract, {
  auth: organizationAccess('publish:manage'),
  handler: async ({ access, body }) => {
    if (!contentDraftsEnabled()) return errorResponse(404, 'Post not found.')
    await backendSDK(access).swapContentDraftPosts(body.first, body.second)
    return { swapped: true as const }
  },
})
