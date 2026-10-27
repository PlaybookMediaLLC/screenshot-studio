import { updateDraftPropertiesContract } from '@/lib/api/contracts/write'
import { errorResponse, route } from '@/lib/api/route'
import { tenantAccess } from '@/lib/api/route-auth'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'
import { updateDraftProperties } from '@/lib/tenant/write'

const notFound = () => errorResponse(404, 'Content draft not found.')

/** Pin, tag or annotate a draft; its version and approval stay. */
export const PATCH = route(updateDraftPropertiesContract, {
  auth: tenantAccess(updateDraftPropertiesContract.access),
  handler: async ({ access, body, params }) =>
    contentDraftsEnabled()
      ? ((await updateDraftProperties(access, params.id, body)) ?? notFound())
      : notFound(),
})
