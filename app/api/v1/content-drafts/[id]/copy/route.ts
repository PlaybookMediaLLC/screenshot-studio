import { copyContentDraftContract } from '@/lib/api/contracts/write'
import { errorResponse, route } from '@/lib/api/route'
import { tenantAccess } from '@/lib/api/route-auth'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'
import { copyContentDraft } from '@/lib/tenant/write'

const notFound = () => errorResponse(404, 'Content draft or social set not found.')

/** Copy a draft into another social set. */
export const POST = route(copyContentDraftContract, {
  auth: tenantAccess(copyContentDraftContract.access),
  handler: async ({ access, body, params }) =>
    contentDraftsEnabled()
      ? ((await copyContentDraft(access, params.id, body)) ?? notFound())
      : notFound(),
})
