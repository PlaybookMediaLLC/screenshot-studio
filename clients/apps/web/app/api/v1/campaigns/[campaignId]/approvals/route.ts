import { decideCampaignApprovalContract } from '@/lib/api/contracts/approvals'
import { route } from '@/lib/api/route'
import { memberAccess } from '@/lib/api/route-auth'
import { transitionCampaignPosts } from '@/lib/tenant/campaigns'

/** A signed-in approver's batch decision on posts waiting for review. */
export const POST = route(decideCampaignApprovalContract, {
  auth: memberAccess(decideCampaignApprovalContract.access),
  handler: async ({ access, body, params }) =>
    transitionCampaignPosts(access, params.campaignId, body.decision, body.postIds, body.note),
})
