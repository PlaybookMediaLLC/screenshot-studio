import { completeBlueskyConnectionContract } from '@/lib/api/contracts/bluesky-connections'
import { route } from '@/lib/api/route'
import { memberAccess } from '@/lib/api/route-auth'
import { backendSDK } from '@/lib/backend/sdk'

/** Complete against the attempt's original authorized workspace, including receipt-only retries. */
export const POST = route(completeBlueskyConnectionContract, {
  auth: memberAccess(completeBlueskyConnectionContract.access),
  handler: ({ access, body }) => backendSDK(access).completeBlueskyConnection(body),
})
