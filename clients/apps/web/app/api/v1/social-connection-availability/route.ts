import { getSocialConnectionAvailabilityContract } from '@/lib/api/contracts/social-availability'
import { errorResponse, route } from '@/lib/api/route'
import { memberAccess } from '@/lib/api/route-auth'
import { backendSDK } from '@/lib/backend/sdk'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'

/** Read configuration readiness through the authenticated Go tenant boundary. */
export const GET = route(getSocialConnectionAvailabilityContract, {
  auth: memberAccess(getSocialConnectionAvailabilityContract.access),
  handler: ({ access }) => {
    if (!contentDraftsEnabled()) return errorResponse(404, 'Social sets are not available.')
    return backendSDK(access).socialConnectionAvailability()
  },
})
