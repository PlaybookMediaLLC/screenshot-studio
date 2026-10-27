import { getEntitlementContract } from '@/lib/api/contracts/audit'
import { route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { backendSDK } from '@/lib/backend/sdk'

/** The active organization's contract entitlement. Owner-level, fresh two-factor sign-in only. */
export const GET = route(getEntitlementContract, {
  auth: organizationAccess('workspace:delete', { sensitive: true }),
  handler: async ({ access }) => backendSDK(access).getWorkspaceEntitlement(),
})
