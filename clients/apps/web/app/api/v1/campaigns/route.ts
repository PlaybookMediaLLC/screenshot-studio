import { createCampaignContract, listCampaignsContract } from '@/lib/api/contracts/campaigns'
import { route } from '@/lib/api/route'
import { tenantAccess } from '@/lib/api/route-auth'
import { createCampaign, listCampaigns } from '@/lib/tenant/campaigns'

/** Every campaign in the workspace, newest first, as one page. */
export const GET = route(listCampaignsContract, {
  auth: tenantAccess(listCampaignsContract.access),
  handler: async ({ access }) => ({
    data: await listCampaigns(access),
    pagination: { hasMore: false, nextCursor: null },
  }),
})

/** Create a draft campaign. Replaying an `Idempotency-Key` returns the original with 200. */
export const POST = route(createCampaignContract, {
  auth: tenantAccess(createCampaignContract.access),
  handler: async ({ access, body, headers }) => {
    const { created, ...campaign } = await createCampaign(
      access,
      body,
      headers['idempotency-key'] || undefined
    )
    return { campaign, created }
  },
  status: (result) => (result.created ? 201 : 200),
})
