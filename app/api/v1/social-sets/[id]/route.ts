import {
  deleteSocialSetContract,
  getSocialSetContract,
  updateSocialSetContract,
} from '@/lib/api/contracts/social-sets'
import { errorResponse, route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { backendSDK } from '@/lib/backend/sdk'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'

/** One social set. */
export const GET = route(getSocialSetContract, {
  auth: organizationAccess('artifact:read'),
  handler: ({ access, params }) =>
    contentDraftsEnabled()
      ? backendSDK(access).getSocialSet(params.id)
      : errorResponse(404, 'Social sets are not available.'),
})

/** Save a social set, based on the version you read. */
export const PATCH = route(updateSocialSetContract, {
  auth: organizationAccess('connection:manage'),
  handler: ({ access, body, params }) =>
    contentDraftsEnabled()
      ? backendSDK(access).updateSocialSet(params.id, body)
      : errorResponse(404, 'Social sets are not available.'),
})

/** Delete a social set; the backend checks you own it or administer the workspace. */
export const DELETE = route(deleteSocialSetContract, {
  auth: organizationAccess('workspace:read'),
  handler: ({ access, body, params }) =>
    contentDraftsEnabled()
      ? backendSDK(access).deleteSocialSet(params.id, body.confirmation)
      : errorResponse(404, 'Social sets are not available.'),
})
