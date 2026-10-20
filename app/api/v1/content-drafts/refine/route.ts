import { refineContract } from '@/lib/api/contracts/write-ai'
import { route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { aiUnavailable, writingContext } from '@/lib/write/ai-route'
import { refineTexts } from '@/lib/write/refine'

/** Refine a draft's texts with AI; the composer applies them only when accepted. */
export const POST = route(refineContract, {
  auth: organizationAccess('artifact:edit'),
  handler: async ({ access, body }) =>
    (await aiUnavailable(access)) ??
    refineTexts(access, body, await writingContext(access, body.draftId, body.channel)),
})
