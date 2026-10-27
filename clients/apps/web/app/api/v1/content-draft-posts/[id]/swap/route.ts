import { swapDraftPostsContract } from '@/lib/api/contracts/content-draft-platform'
import { errorResponse, route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'
import { swapContentDraftPosts } from '@/lib/tenant/content-drafts'

/** Atomically swap two queued posts, preserving their publication snapshots. */
export const POST = route(swapDraftPostsContract, {
  auth: organizationAccess('publish:manage'),
  handler: async ({ access, body, params }) => {
    if (!contentDraftsEnabled()) return errorResponse(404, 'Post not found.')
    const posts = await swapContentDraftPosts(access, params.id, body.withId)
    return posts ? { posts } : errorResponse(404, 'Post not found.')
  },
})
