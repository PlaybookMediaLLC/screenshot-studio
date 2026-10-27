import { searchCommunitiesContract } from '@/lib/api/contracts/social-communities'
import { errorResponse, route } from '@/lib/api/route'
import { memberAccess } from '@/lib/api/route-auth'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'
import { searchSocialSetCommunities } from '@/lib/tenant/write'

/** Search X communities with the account's own permissions and rate limit. */
export const GET = route(searchCommunitiesContract, {
  auth: memberAccess(searchCommunitiesContract.access),
  handler: async ({ access, params, query }) => {
    if (!contentDraftsEnabled()) return errorResponse(404, 'Social set not found.')
    const items = await searchSocialSetCommunities(access, params.id, query.q)
    return items ? { items } : errorResponse(404, 'Social set not found.')
  },
})
