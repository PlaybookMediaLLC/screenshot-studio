import { scheduleContentDraftContract } from '@/lib/api/contracts/content-drafts'
import { errorResponse, route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'
import { scheduleContentDraft } from '@/lib/tenant/content-drafts'

/** Schedule a draft to channels: one post each; a repeat at the same version replays. */
export const POST = route(scheduleContentDraftContract, {
  auth: organizationAccess('publish:manage'),
  handler: async ({ access, body, params }) => {
    if (!contentDraftsEnabled()) return errorResponse(404, 'Content draft not found.')
    return (
      (await scheduleContentDraft(access, params.id, body)) ??
      errorResponse(404, 'Content draft not found.')
    )
  },
  status: (result) => (result.created ? 201 : 200),
})
