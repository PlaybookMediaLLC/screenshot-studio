import { previewMastodonInstanceContract } from '@/lib/api/contracts/social-instances'
import { route } from '@/lib/api/route'
import { memberAccess } from '@/lib/api/route-auth'
import { backendSDK } from '@/lib/backend/sdk'

/** Fetch a bounded public preview through the backend’s SSRF-safe client. */
export const GET = route(previewMastodonInstanceContract, {
  auth: memberAccess(previewMastodonInstanceContract.access),
  handler: ({ access, query }) => backendSDK(access).previewMastodonInstance(query.server),
})
