import { planContentDraftContract } from '@/lib/api/contracts/write'
import { errorResponse, route } from '@/lib/api/route'
import { tenantAccess } from '@/lib/api/route-auth'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'
import { planContentDraft } from '@/lib/tenant/write'

const notFound = () => errorResponse(404, 'Content draft not found.')

/** Plan a draft on the calendar, or clear its plan. Nothing publishes from a plan. */
export const POST = route(planContentDraftContract, {
  auth: tenantAccess(planContentDraftContract.access),
  handler: async ({ access, body, params }) =>
    contentDraftsEnabled()
      ? ((await planContentDraft(access, params.id, body)) ?? notFound())
      : notFound(),
})
