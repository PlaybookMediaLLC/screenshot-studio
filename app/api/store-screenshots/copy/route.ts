import { isCampaignStudioConfigured } from '@/lib/ai/agents/campaign-studio'
import { withAiCredits } from '@/lib/ai/metering'
import { suggestCopy } from '@/lib/ai/store-screenshots/copy'
import { storeCopyContract } from '@/lib/api/contracts/store-screenshots'
import { errorResponse, route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'

/** Copy generation runs one model call. */
export const maxDuration = 60

/** Suggest headlines grounded in the supplied product facts, charged to AI credits. */
export const POST = route(storeCopyContract, {
  auth: organizationAccess('artifact:edit'),
  handler: async ({ access, body }) => {
    if (!isCampaignStudioConfigured())
      return errorResponse(503, 'AI copy is not configured on this server.')
    return withAiCredits(access, () => suggestCopy(body))
  },
})
