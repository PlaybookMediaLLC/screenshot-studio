import { resumeDraftThreadContract } from '@/lib/api/contracts/content-draft-platform'
import { errorResponse, route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'
import { resumeContentDraftThread } from '@/lib/tenant/content-drafts'

/** Post the rest of a thread that stopped partway, now. */
export const POST = route(resumeDraftThreadContract, {
  auth: organizationAccess('publish:manage'),
  handler: async ({ access, params }) => {
    if (!contentDraftsEnabled()) return errorResponse(404, 'Post not found.')
    const post = await resumeContentDraftThread(access, params.id)
    return post ? { post } : errorResponse(404, 'Post not found.')
  },
})
