import { requestCampaignReviewContract } from '@/lib/api/contracts/approvals'
import { route } from '@/lib/api/route'
import { tenantAccess } from '@/lib/api/route-auth'
import { requestCampaignReview } from '@/lib/tenant/campaigns'

/** Submit draft posts for review; only a person decides on them. */
export const POST = route(requestCampaignReviewContract, {
  auth: tenantAccess(requestCampaignReviewContract.access),
  handler: async ({ access, body, params }) =>
    requestCampaignReview(access, params.campaignId, body.postIds),
})
