import {
  createSocialSetContract,
  listSocialSetsContract,
} from '@/lib/api/contracts/settings-platform'
import { errorResponse, route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { backendSDK } from '@/lib/backend/sdk'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'

/** The social sets you can see. */
export const GET = route(listSocialSetsContract, {
  auth: organizationAccess('artifact:read'),
  handler: ({ access }) =>
    contentDraftsEnabled()
      ? backendSDK(access).listSocialSets()
      : errorResponse(404, 'Social sets are not available.'),
})

/** Create a social set, shared with the workspace or private to you. */
export const POST = route(createSocialSetContract, {
  auth: organizationAccess('publish:manage'),
  handler: ({ access, body }) =>
    contentDraftsEnabled()
      ? backendSDK(access).createSocialSet(body)
      : errorResponse(404, 'Social sets are not available.'),
})
