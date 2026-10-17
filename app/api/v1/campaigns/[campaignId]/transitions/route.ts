import { transitionCampaignContract } from '@/lib/api/contracts/campaigns'
import { route } from '@/lib/api/route'
import { tenantAccess } from '@/lib/api/route-auth'
import { transitionCampaign } from '@/lib/tenant/campaigns'

/** Move a campaign to another status; the backend's transition table decides who may. */
export const POST = route(transitionCampaignContract, {
  auth: tenantAccess(transitionCampaignContract.access),
  handler: async ({ access, body, params }) =>
    transitionCampaign(access, params.campaignId, body.status),
})
