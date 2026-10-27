import { listContentDraftRevisionsContract } from '@/lib/api/contracts/content-draft-platform'
import { errorResponse, route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'
import { listContentDraftRevisions } from '@/lib/tenant/content-drafts'

/** The draft's saved revisions, newest first. */
export const GET = route(listContentDraftRevisionsContract, {
  auth: organizationAccess('artifact:read'),
  handler: async ({ access, params }) => {
    if (!contentDraftsEnabled()) return errorResponse(404, 'Content draft not found.')
    const items = await listContentDraftRevisions(access, params.id)
    return items ? { items } : errorResponse(404, 'Content draft not found.')
  },
})
