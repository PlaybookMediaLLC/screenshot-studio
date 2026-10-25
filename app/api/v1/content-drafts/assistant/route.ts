import { assistantContract } from '@/lib/api/contracts/write-ai'
import { errorResponse, route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { aiUnavailable, writingContext } from '@/lib/write/ai-route'
import { assistantReply } from '@/lib/write/refine'

/** Ask the writing assistant about a draft, in its set's voice. */
export const POST = route(assistantContract, {
  auth: organizationAccess('artifact:edit'),
  handler: async ({ access, body }) => {
    const unavailable = await aiUnavailable(access)
    if (unavailable) return unavailable
    const context = await writingContext(access, body.draftId, body.channel)
    if (body.draftId !== undefined && !context) return errorResponse(404, 'Draft not found.')
    return assistantReply(access, body, context)
  },
})
