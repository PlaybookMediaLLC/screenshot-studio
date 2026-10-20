import { listPlannedContentDraftsContract } from '@/lib/api/contracts/write'
import { errorResponse, route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'
import { listPlannedContentDrafts } from '@/lib/tenant/write'

/** Drafts planned between two times, for the calendar. */
export const GET = route(listPlannedContentDraftsContract, {
  auth: organizationAccess('artifact:read'),
  handler: async ({ access, query }) =>
    contentDraftsEnabled()
      ? {
          items: await listPlannedContentDrafts(
            access,
            new Date(query.from),
            new Date(query.to),
            query.socialSetId
          ),
        }
      : errorResponse(404, 'Content drafts are not enabled.'),
})
