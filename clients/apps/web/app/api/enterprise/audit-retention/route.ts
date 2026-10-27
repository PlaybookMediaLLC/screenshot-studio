import { getAuditRetentionContract, updateAuditRetentionContract } from '@/lib/api/contracts/audit'
import { route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { getAuditRequestMetadata } from '@/lib/audit/request'
import { backendSDK } from '@/lib/backend/sdk'

/** The organization's audit retention policy. */
export const GET = route(getAuditRetentionContract, {
  auth: organizationAccess('audit:read', { scope: 'requested' }),
  handler: async ({ access }) => backendSDK(access).getAuditRetention(),
})

/** Change the retention period or legal hold. */
export const PUT = route(updateAuditRetentionContract, {
  auth: organizationAccess('audit:manage', { scope: 'requested', sensitive: true }),
  handler: async ({ access, body, request }) =>
    backendSDK(access).updateAuditRetention(
      { legalHold: body.legalHold, retentionDays: body.retentionDays },
      getAuditRequestMetadata(request.headers)
    ),
})
