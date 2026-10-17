import { isCampaignStudioConfigured } from '@/lib/ai/agents/campaign-studio'
import { withAiCredits } from '@/lib/ai/metering'
import { TranslationResultError, translateStrings } from '@/lib/ai/store-screenshots/translate'
import { storeTranslateContract } from '@/lib/api/contracts/store-screenshots'
import { errorResponse, route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'

/** Translation batches can take a little while on slower models. */
export const maxDuration = 60

/** Translate store screenshot strings into one locale, charged to AI credits. */
export const POST = route(storeTranslateContract, {
  auth: organizationAccess('artifact:edit'),
  handler: async ({ access, body }) => {
    if (!isCampaignStudioConfigured())
      return errorResponse(503, 'AI translation is not configured on this server.')
    if (body.sourceLocale === body.targetLocale)
      return errorResponse(400, 'Choose a different target language.')
    try {
      const translations = await withAiCredits(access, () => translateStrings(body))
      return { translations }
    } catch (cause) {
      if (cause instanceof TranslationResultError) return errorResponse(503, cause.message)
      throw cause
    }
  },
})
