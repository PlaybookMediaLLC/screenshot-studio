import 'server-only'

import { isCampaignStudioConfigured } from '@/lib/ai/agents/campaign-studio'
import { errorResponse } from '@/lib/api/route'
import type { OrganizationAccess } from '@/lib/auth/access'
import { backendSDK, orNull } from '@/lib/backend/sdk'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'
import { isAiEnabled } from '@/lib/trpc/routers/launch'

/**
 * Why Write's AI cannot answer for this workspace, as a response, or null
 * when it can.
 */
export async function aiUnavailable(access: OrganizationAccess) {
  if (!contentDraftsEnabled()) return errorResponse(404, 'Content drafts are not available.')
  if (!isCampaignStudioConfigured()) return errorResponse(503, 'AI is not configured.')
  if (!(await isAiEnabled(access)))
    return errorResponse(403, 'AI is turned off for this workspace.')
  return null
}

/**
 * The draft's writing context for a channel: the workspace brand refined by
 * its social set (RFC 043), when the caller may see the draft.
 */
export async function writingContext(
  access: OrganizationAccess,
  draftId: string | undefined,
  channel: string
) {
  return draftId ? orNull(backendSDK(access).getDraftWritingContext(draftId, channel)) : null
}
