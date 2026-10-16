import { suggestLinkCopyContract } from '@/lib/api/contracts/link-preview'
import { LAUNCH_AI_RATE_LIMIT } from '@/lib/api/rate-limit-policy'
import { errorResponse, route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { isCampaignStudioConfigured } from '@/lib/ai/agents/campaign-studio'
import { suggestLinkCopy } from '@/lib/link-preview/suggest'
import { checkRateLimit } from '@/lib/rate-limit'
import { consumeWorkspaceQuota } from '@/lib/tenant/entitlements'

/** The page fetch plus a few model steps. */
export const maxDuration = 60

/**
 * `POST /api/link-preview/suggestions`: three title and description options
 * for a page. Like the launch pipeline's AI actions it checks that AI is
 * configured, rate-limits per workspace, and spends one generation unit.
 */
export const POST = route(suggestLinkCopyContract, {
  auth: organizationAccess('artifact:edit'),
  handler: async ({ access, body }) => {
    if (!isCampaignStudioConfigured()) {
      return errorResponse(503, 'AI is not configured for this workspace.')
    }
    const limit = await checkRateLimit(
      `link-copy-ai:${access.organizationId}`,
      LAUNCH_AI_RATE_LIMIT
    )
    if (!limit.allowed)
      return errorResponse(429, 'Too many AI requests. Wait a minute and try again.')
    await consumeWorkspaceQuota(access, 'generation:monthly')
    return { variants: await suggestLinkCopy(body.url, body.agent) }
  },
})
