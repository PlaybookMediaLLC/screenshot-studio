import { shareContentDraftContract } from '@/lib/api/contracts/content-draft-platform'
import { errorResponse, route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'
import { shareContentDraft } from '@/lib/tenant/content-drafts'

/** Turn the draft's read-and-comment link on (a new link) or off. */
export const PUT = route(shareContentDraftContract, {
  auth: organizationAccess('artifact:edit'),
  handler: async ({ access, body, params }) => {
    if (!contentDraftsEnabled()) return errorResponse(404, 'Content draft not found.')
    return (
      (await shareContentDraft(access, params.id, body.enabled)) ??
      errorResponse(404, 'Content draft not found.')
    )
  },
})
