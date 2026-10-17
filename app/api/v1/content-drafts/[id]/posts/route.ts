import { listContentDraftPostsContract } from '@/lib/api/contracts/content-drafts'
import { errorResponse, route } from '@/lib/api/route'
import { tenantAccess } from '@/lib/api/route-auth'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'
import { listContentDraftPosts } from '@/lib/tenant/content-drafts'

/** The posts scheduled from a draft and their statuses. */
export const GET = route(listContentDraftPostsContract, {
  auth: tenantAccess({ apiKeyScope: 'artifact:read', permission: 'artifact:read' }),
  handler: async ({ access, params }) => {
    const posts = contentDraftsEnabled() ? await listContentDraftPosts(access, params.id) : null
    return posts ? { posts } : errorResponse(404, 'Content draft not found.')
  },
})
