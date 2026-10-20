import { recoverContentDraftRevisionContract } from '@/lib/api/contracts/write'
import { errorResponse, route } from '@/lib/api/route'
import { tenantAccess } from '@/lib/api/route-auth'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'
import { recoverContentDraftRevision } from '@/lib/tenant/write'

const notFound = () => errorResponse(404, 'Content draft or backup not found.')

/** A new draft from an automatic backup; the source stays as it is. */
export const POST = route(recoverContentDraftRevisionContract, {
  auth: tenantAccess(recoverContentDraftRevisionContract.access),
  handler: async ({ access, params }) =>
    contentDraftsEnabled()
      ? ((await recoverContentDraftRevision(access, params.id, params.revisionId)) ?? notFound())
      : notFound(),
})
