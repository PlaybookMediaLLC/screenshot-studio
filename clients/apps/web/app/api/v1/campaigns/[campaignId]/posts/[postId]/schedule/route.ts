import { scheduleCampaignPostContract } from '@/lib/api/contracts/campaigns'
import { route } from '@/lib/api/route'
import { tenantAccess } from '@/lib/api/route-auth'
import { scheduleCampaignPost } from '@/lib/tenant/campaigns'

/** Schedule an approved post; only a person approves it. */
export const POST = route(scheduleCampaignPostContract, {
  auth: tenantAccess(scheduleCampaignPostContract.access),
  handler: async ({ access, body, params }) =>
    scheduleCampaignPost(access, params.campaignId, params.postId, body),
})
