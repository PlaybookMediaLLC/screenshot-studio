import { refineContract } from '@/lib/api/contracts/write-ai'
import { errorResponse, route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { aiUnavailable, writingContext } from '@/lib/write/ai-route'
import { refineTexts } from '@/lib/write/refine'

/** Refine a draft's texts with AI; the composer applies them only when accepted. */
export const POST = route(refineContract, {
  auth: organizationAccess('artifact:edit'),
  handler: async ({ access, body }) => {
    const unavailable = await aiUnavailable(access)
    if (unavailable) return unavailable
    const context = await writingContext(access, body.draftId, body.channel)
    if (body.draftId !== undefined && !context) return errorResponse(404, 'Draft not found.')
    return refineTexts(access, body, context)
  },
})
