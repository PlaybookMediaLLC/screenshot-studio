import { reconcileDraftPostContract } from '@/lib/api/contracts/write'
import { errorResponse, route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'
import { reconcileContentDraftPost } from '@/lib/tenant/content-drafts'

const notFound = () => errorResponse(404, 'Post not found.')

/** Settle a post of unknown outcome as live or not live; nothing is sent to the platform. */
export const POST = route(reconcileDraftPostContract, {
  auth: organizationAccess('publish:manage'),
  handler: async ({ access, body, params }) => {
    if (!contentDraftsEnabled()) return notFound()
    const post = await reconcileContentDraftPost(access, params.id, body)
    return post ? { post } : notFound()
  },
})
