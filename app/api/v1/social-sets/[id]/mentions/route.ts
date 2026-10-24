import { lookupMentionsContract } from '@/lib/api/contracts/social-mentions'
import { errorResponse, route } from '@/lib/api/route'
import { memberAccess } from '@/lib/api/route-auth'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'
import { lookupSocialSetMentions } from '@/lib/tenant/write'

const notFound = () => errorResponse(404, 'Social set not found.')

/** Look a mention up with the set's own account; members only, never an API key. */
export const GET = route(lookupMentionsContract, {
  auth: memberAccess(lookupMentionsContract.access),
  handler: async ({ access, params, query }) => {
    if (!contentDraftsEnabled()) return notFound()
    const items = await lookupSocialSetMentions(
      access,
      params.id,
      query.channel,
      query.q,
      query.kind
    )
    return items ? { items } : notFound()
  },
})
