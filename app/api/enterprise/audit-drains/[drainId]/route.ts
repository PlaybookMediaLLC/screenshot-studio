import { deleteAuditDrainContract } from '@/lib/api/contracts/audit'
import { route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { getAuditRequestMetadata } from '@/lib/audit/request'
import { backendSDK } from '@/lib/backend/sdk'

/** Stop delivering audit events to a drain. */
export const DELETE = route(deleteAuditDrainContract, {
  auth: organizationAccess('audit:manage', { scope: 'requested', sensitive: true }),
  handler: async ({ access, params, request }) => {
    await backendSDK(access).deleteAuditDrain(
      params.drainId,
      getAuditRequestMetadata(request.headers)
    )
    return undefined
  },
})
