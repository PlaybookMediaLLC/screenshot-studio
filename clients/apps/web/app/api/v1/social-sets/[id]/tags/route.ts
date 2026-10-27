import { createDraftTagContract, listDraftTagsContract } from '@/lib/api/contracts/draft-tags'
import { errorResponse, route } from '@/lib/api/route'
import { tenantAccess } from '@/lib/api/route-auth'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'
import { createDraftTag, listDraftTags } from '@/lib/tenant/write'

const notFound = () => errorResponse(404, 'Social set not found.')

/** A social set's tags. */
export const GET = route(listDraftTagsContract, {
  auth: tenantAccess(listDraftTagsContract.access),
  handler: async ({ access, params }) => {
    if (!contentDraftsEnabled()) return notFound()
    const items = await listDraftTags(access, params.id)
    return items ? { items } : notFound()
  },
})

/** Add a tag to a social set. */
export const POST = route(createDraftTagContract, {
  auth: tenantAccess(createDraftTagContract.access),
  handler: async ({ access, body, params }) =>
    contentDraftsEnabled()
      ? ((await createDraftTag(access, params.id, body)) ?? notFound())
      : notFound(),
})
