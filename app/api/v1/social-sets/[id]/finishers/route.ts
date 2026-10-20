import {
  createDraftFinisherContract,
  listDraftFinishersContract,
} from '@/lib/api/contracts/draft-tags'
import { errorResponse, route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'
import { createDraftFinisher, listDraftFinishers } from '@/lib/tenant/write'

const notFound = () => errorResponse(404, 'Social set not found.')

/** A social set's thread finishers. */
export const GET = route(listDraftFinishersContract, {
  auth: organizationAccess('artifact:read'),
  handler: async ({ access, params }) => {
    if (!contentDraftsEnabled()) return notFound()
    const items = await listDraftFinishers(access, params.id)
    return items ? { items } : notFound()
  },
})

/** Add a thread finisher to a social set. */
export const POST = route(createDraftFinisherContract, {
  auth: organizationAccess('artifact:edit'),
  handler: async ({ access, body, params }) =>
    contentDraftsEnabled()
      ? ((await createDraftFinisher(access, params.id, body)) ?? notFound())
      : notFound(),
})
