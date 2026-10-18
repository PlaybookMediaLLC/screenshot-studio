import { getCampaignContract } from '@/lib/api/contracts/campaigns'
import { errorResponse, route } from '@/lib/api/route'
import { tenantAccess } from '@/lib/api/route-auth'
import { getCampaign } from '@/lib/tenant/campaigns'

/** A campaign with its angles, posts, assets, product page, and release. */
export const GET = route(getCampaignContract, {
  auth: tenantAccess(getCampaignContract.access),
  handler: async ({ access, params }) =>
    (await getCampaign(access, params.campaignId)) ?? errorResponse(404, 'Campaign not found.'),
})
