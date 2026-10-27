import {
  deleteDraftFinisherContract,
  updateDraftFinisherContract,
} from '@/lib/api/contracts/draft-tags'
import { errorResponse, route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'
import { deleteDraftFinisher, updateDraftFinisher } from '@/lib/tenant/write'

const notFound = () => errorResponse(404, 'Finisher not found.')

/** Edit a thread finisher. */
export const PATCH = route(updateDraftFinisherContract, {
  auth: organizationAccess('artifact:edit'),
  handler: async ({ access, body, params }) =>
    contentDraftsEnabled()
      ? ((await updateDraftFinisher(access, params.id, params.finisherId, body)) ?? notFound())
      : notFound(),
})

/** Delete a thread finisher. */
export const DELETE = route(deleteDraftFinisherContract, {
  auth: organizationAccess('artifact:edit'),
  handler: async ({ access, params }) =>
    contentDraftsEnabled() && (await deleteDraftFinisher(access, params.id, params.finisherId))
      ? { deleted: true as const }
      : notFound(),
})
