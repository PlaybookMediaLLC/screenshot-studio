import { getContentDraftRevisionContract } from '@/lib/api/contracts/content-draft-platform'
import { errorResponse, route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'
import { getContentDraftRevision } from '@/lib/tenant/content-drafts'

/** One revision with its body, to restore it. */
export const GET = route(getContentDraftRevisionContract, {
  auth: organizationAccess('artifact:read'),
  handler: async ({ access, params }) => {
    if (!contentDraftsEnabled()) return errorResponse(404, 'Revision not found.')
    return (
      (await getContentDraftRevision(access, params.id, params.revisionId)) ??
      errorResponse(404, 'Revision not found.')
    )
  },
})
