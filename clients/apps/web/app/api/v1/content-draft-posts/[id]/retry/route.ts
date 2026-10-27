import { retryDraftPostContract } from '@/lib/api/contracts/write'
import { errorResponse, route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'
import { retryContentDraftPost } from '@/lib/tenant/content-drafts'

const notFound = () => errorResponse(404, 'Post not found.')

/** Publish one failed destination again, once; the draft's other posts stay as they are. */
export const POST = route(retryDraftPostContract, {
  auth: organizationAccess('publish:manage'),
  handler: async ({ access, params }) => {
    if (!contentDraftsEnabled()) return notFound()
    const post = await retryContentDraftPost(access, params.id)
    return post ? { post } : notFound()
  },
})
