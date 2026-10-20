import { isCampaignStudioConfigured } from '@/lib/ai/agents/campaign-studio'
import { draftAssistContract } from '@/lib/api/contracts/content-draft-platform'
import { errorResponse, route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { assistDraft } from '@/lib/content-drafts/assist'
import { backendSDK, orNull } from '@/lib/backend/sdk'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'
import { isAiEnabled } from '@/lib/trpc/routers/launch'

/** Rewrite, thread or shorten a draft for a channel, in its social set's voice. */
export const POST = route(draftAssistContract, {
  auth: organizationAccess('artifact:edit'),
  handler: async ({ access, body }) => {
    if (!contentDraftsEnabled()) return errorResponse(404, 'Content drafts are not available.')
    if (!isCampaignStudioConfigured()) return errorResponse(503, 'AI is not configured.')
    if (!(await isAiEnabled(access)))
      return errorResponse(403, 'AI is turned off for this workspace.')
    const context = body.draftId
      ? await orNull(backendSDK(access).getDraftWritingContext(body.draftId, body.channel))
      : null
    return assistDraft(access, body, context)
  },
})
