import { listAuditLogsContract } from '@/lib/api/contracts/audit'
import { route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { getAuditRequestMetadata } from '@/lib/audit/request'
import { backendSDK } from '@/lib/backend/sdk'

/** Never prerender: every read is per-session and audited. */
export const dynamic = 'force-dynamic'

/** Page through the organization's audit log. Reading it is itself audited. */
export const GET = route(listAuditLogsContract, {
  auth: organizationAccess('audit:read', { scope: 'requested' }),
  handler: async ({ access, query, request }) =>
    backendSDK(access).listAuditLogs(query, getAuditRequestMetadata(request.headers)),
})
