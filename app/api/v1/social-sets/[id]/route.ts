import {
  deleteSocialSetContract,
  getSocialSetContract,
  updateSocialSetContract,
} from '@/lib/api/contracts/social-sets'
import { errorResponse, route } from '@/lib/api/route'
import { memberAccess, tenantAccess } from '@/lib/api/route-auth'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'
import { deleteSocialSet, getSocialSet, updateSocialSet } from '@/lib/tenant/write'

const notFound = () => errorResponse(404, 'Social set not found.')

/** One social set with its accounts and their health. */
export const GET = route(getSocialSetContract, {
  auth: tenantAccess(getSocialSetContract.access),
  handler: async ({ access, params }) =>
    contentDraftsEnabled() ? ((await getSocialSet(access, params.id)) ?? notFound()) : notFound(),
})

/** Change a social set. */
export const PATCH = route(updateSocialSetContract, {
  auth: memberAccess(updateSocialSetContract.access),
  handler: async ({ access, body, params }) =>
    contentDraftsEnabled()
      ? ((await updateSocialSet(access, params.id, body)) ?? notFound())
      : notFound(),
})

/** Delete an empty social set. */
export const DELETE = route(deleteSocialSetContract, {
  auth: memberAccess(deleteSocialSetContract.access),
  handler: async ({ access, params }) =>
    contentDraftsEnabled() && (await deleteSocialSet(access, params.id))
      ? { deleted: true as const }
      : notFound(),
})
