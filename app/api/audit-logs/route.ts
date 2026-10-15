import { NextRequest, NextResponse } from 'next/server'
import { backendSDK } from '@/lib/backend/sdk'
import { getAuditIpHash, getUserAgentSummary } from '@/lib/audit/request'
import { auditLogQuerySchema } from '@/lib/audit/query'
import { requireOrganizationPermission } from '@/lib/auth/access'
import { getRouteErrorResponse } from '@/lib/api/route-errors'

export const dynamic = 'force-dynamic'

function getQueryInput(request: NextRequest) {
  return auditLogQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams))
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const input = getQueryInput(request)
    const access = await requireOrganizationPermission(
      request.headers,
      input.organizationId,
      'audit:read'
    )
    return NextResponse.json(
      await backendSDK(access).listAuditLogs(input, {
        ipHash: getAuditIpHash(request.headers),
        userAgentSummary: getUserAgentSummary(request.headers),
      })
    )
  } catch (error) {
    return getRouteErrorResponse(error)
  }
}
