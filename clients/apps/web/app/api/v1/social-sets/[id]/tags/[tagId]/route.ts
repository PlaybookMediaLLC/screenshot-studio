import { deleteDraftTagContract, updateDraftTagContract } from '@/lib/api/contracts/draft-tags'
import { errorResponse, route } from '@/lib/api/route'
import { tenantAccess } from '@/lib/api/route-auth'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'
import { deleteDraftTag, updateDraftTag } from '@/lib/tenant/write'

const notFound = () => errorResponse(404, 'Tag not found.')

/** Rename or recolour a tag. */
export const PATCH = route(updateDraftTagContract, {
  auth: tenantAccess(updateDraftTagContract.access),
  handler: async ({ access, body, params }) =>
    contentDraftsEnabled()
      ? ((await updateDraftTag(access, params.id, params.tagId, body)) ?? notFound())
      : notFound(),
})

/** Delete a tag and take it off the set's drafts. */
export const DELETE = route(deleteDraftTagContract, {
  auth: tenantAccess(deleteDraftTagContract.access),
  handler: async ({ access, params }) =>
    contentDraftsEnabled() && (await deleteDraftTag(access, params.id, params.tagId))
      ? { deleted: true as const }
      : notFound(),
})
