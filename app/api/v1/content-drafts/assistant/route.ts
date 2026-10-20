import { assistantContract } from '@/lib/api/contracts/write-ai'
import { route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { aiUnavailable, writingContext } from '@/lib/write/ai-route'
import { assistantReply } from '@/lib/write/refine'

/** Ask the writing assistant about a draft, in its set's voice. */
export const POST = route(assistantContract, {
  auth: organizationAccess('artifact:edit'),
  handler: async ({ access, body }) =>
    (await aiUnavailable(access)) ??
    assistantReply(access, body, await writingContext(access, body.draftId, body.channel)),
})
