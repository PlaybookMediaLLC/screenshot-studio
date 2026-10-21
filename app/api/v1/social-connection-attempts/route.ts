import { createSocialConnectionAttemptContract } from '@/lib/api/contracts/social-connections'
import { errorResponse, route } from '@/lib/api/route'
import { memberAccess } from '@/lib/api/route-auth'
import { backendSDK } from '@/lib/backend/sdk'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'
import { BackendSDKError } from 'screenshot-studio-backend-sdk'

/** Begin a connection without creating an empty social set. */
export const POST = route(createSocialConnectionAttemptContract, {
  auth: memberAccess(createSocialConnectionAttemptContract.access),
  handler: async ({ access, body: { provider, socialSetId, ...options } }) => {
    if (!contentDraftsEnabled()) return errorResponse(404, 'Social sets are not available.')
    try {
      return await backendSDK(access).beginSocialOAuth(provider, socialSetId, options)
    } catch (error) {
      if (error instanceof BackendSDKError && error.status >= 500) {
        return errorResponse(
          503,
          'The provider could not start authorization. Please try again later.'
        )
      }
      throw error
    }
  },
})
