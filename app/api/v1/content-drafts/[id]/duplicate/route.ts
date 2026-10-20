import { duplicateContentDraftContract } from '@/lib/api/contracts/write'
import { errorResponse, route } from '@/lib/api/route'
import { tenantAccess } from '@/lib/api/route-auth'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'
import { duplicateContentDraft } from '@/lib/tenant/write'

const notFound = () => errorResponse(404, 'Content draft not found.')

/** Duplicate a draft in its social set. */
export const POST = route(duplicateContentDraftContract, {
  auth: tenantAccess(duplicateContentDraftContract.access),
  handler: async ({ access, params }) =>
    contentDraftsEnabled()
      ? ((await duplicateContentDraft(access, params.id)) ?? notFound())
      : notFound(),
})
