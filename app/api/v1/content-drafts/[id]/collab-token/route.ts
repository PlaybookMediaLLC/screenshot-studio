import { createCollabTokenContract } from '@/lib/api/contracts/content-drafts'
import { errorResponse, route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'
import { createContentDraftCollabToken } from '@/lib/tenant/content-drafts'

/** A short-lived token for the draft's live session; the editor asks before it expires. */
export const POST = route(createCollabTokenContract, {
  auth: organizationAccess('artifact:read'),
  handler: async ({ access, params }) => {
    const token = contentDraftsEnabled()
      ? await createContentDraftCollabToken(access, params.id)
      : null
    return token ?? errorResponse(404, 'Content draft not found.')
  },
})
