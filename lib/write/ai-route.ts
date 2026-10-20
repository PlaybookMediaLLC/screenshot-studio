import 'server-only'

import { isCampaignStudioConfigured } from '@/lib/ai/agents/campaign-studio'
import { errorResponse } from '@/lib/api/route'
import type { OrganizationAccess } from '@/lib/auth/access'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'
import { getSocialSet } from '@/lib/tenant/write'
import { isAiEnabled } from '@/lib/trpc/routers/launch'
import type { SetVoice } from '@/lib/write/refine'

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

/** A set's voice, when the caller may see the set. */
export async function setVoice(
  access: OrganizationAccess,
  setId: string | undefined
): Promise<SetVoice | null> {
  if (!setId) return null
  const set = await getSocialSet(access, setId)
  return set ? set.preferences : null
}
