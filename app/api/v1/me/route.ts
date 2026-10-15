import { getCurrentUserContract } from '@/lib/api/contracts/shell'
import { route } from '@/lib/api/route'
import { sessionAccess } from '@/lib/api/route-auth'
import { backendSDK } from '@/lib/backend/sdk'

/** The signed-in user. */
export const GET = route(getCurrentUserContract, {
  auth: sessionAccess,
  handler: async ({ access }) => backendSDK({ ...access, organizationId: '' }).getCurrentUser(),
})
