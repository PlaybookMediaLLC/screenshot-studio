import { cancelDraftPostAutomationsContract } from '@/lib/api/contracts/write'
import { errorResponse, route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'
import { cancelContentDraftPostAutomations } from '@/lib/tenant/content-drafts'

const notFound = () => errorResponse(404, 'Post not found.')

/** Stop a live post's pending follow-ups; removals of automatic reposts still run. */
export const POST = route(cancelDraftPostAutomationsContract, {
  auth: organizationAccess('publish:manage'),
  handler: async ({ access, params }) => {
    if (!contentDraftsEnabled()) return notFound()
    const post = await cancelContentDraftPostAutomations(access, params.id)
    return post ? { post } : notFound()
  },
})
