import { reviewContentDraftContract } from '@/lib/api/contracts/content-draft-platform'
import { errorResponse, route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'
import { reviewContentDraft } from '@/lib/tenant/content-drafts'

/** A review step: writers ask; publishers and admins approve or ask for changes. */
export const POST = route(reviewContentDraftContract, {
  auth: organizationAccess('artifact:edit'),
  handler: async ({ access, body, params }) => {
    if (!contentDraftsEnabled()) return errorResponse(404, 'Content draft not found.')
    return (
      (await reviewContentDraft(access, params.id, body)) ??
      errorResponse(404, 'Content draft not found.')
    )
  },
})
