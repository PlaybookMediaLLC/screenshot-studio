import {
  addWritingSampleContract,
  listWritingSamplesContract,
} from '@/lib/api/contracts/settings-platform'
import { errorResponse, route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { backendSDK } from '@/lib/backend/sdk'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'

/** The social set's writing samples. */
export const GET = route(listWritingSamplesContract, {
  auth: organizationAccess('artifact:read'),
  handler: ({ access, params }) =>
    contentDraftsEnabled()
      ? backendSDK(access).listWritingSamples(params.id)
      : errorResponse(404, 'Social sets are not available.'),
})

/** Add a writing sample. */
export const POST = route(addWritingSampleContract, {
  auth: organizationAccess('artifact:edit'),
  handler: ({ access, body, params }) =>
    contentDraftsEnabled()
      ? backendSDK(access).addWritingSample(params.id, body)
      : errorResponse(404, 'Social sets are not available.'),
})
