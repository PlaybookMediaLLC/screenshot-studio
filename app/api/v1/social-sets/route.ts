import { createSocialSetContract, listSocialSetsContract } from '@/lib/api/contracts/social-sets'
import { errorResponse, route } from '@/lib/api/route'
import { memberAccess, tenantAccess } from '@/lib/api/route-auth'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'
import { createSocialSet, listSocialSets } from '@/lib/tenant/write'

const disabled = () => errorResponse(404, 'Content drafts are not enabled.')

/** The social sets the caller may see, the default first. */
export const GET = route(listSocialSetsContract, {
  auth: tenantAccess(listSocialSetsContract.access),
  handler: async ({ access }) =>
    contentDraftsEnabled() ? { items: await listSocialSets(access) } : disabled(),
})

/** Create a social set. Owners and admins manage sets. */
export const POST = route(createSocialSetContract, {
  auth: memberAccess(createSocialSetContract.access),
  handler: async ({ access, body }) =>
    contentDraftsEnabled() ? createSocialSet(access, body) : disabled(),
})
