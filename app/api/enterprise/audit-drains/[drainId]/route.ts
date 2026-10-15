import { NextRequest, NextResponse } from 'next/server'
import { auditDrainListSchema } from '@/lib/audit/drain-schema'
import { getAuditIpHash, getUserAgentSummary } from '@/lib/audit/request'
import { requireSensitiveOrganizationPermission } from '@/lib/auth/access'
import { getRouteErrorResponse } from '@/lib/api/route-errors'
import { backendSDK } from '@/lib/backend/sdk'

type RouteContext = { params: Promise<{ drainId: string }> }

export async function DELETE(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const input = auditDrainListSchema.parse(Object.fromEntries(request.nextUrl.searchParams))
    const access = await requireSensitiveOrganizationPermission(
      request.headers,
      input.organizationId,
      'audit:manage'
    )
    const { drainId } = await context.params
    await backendSDK(access).deleteAuditDrain(drainId, {
      ipHash: getAuditIpHash(request.headers),
      userAgentSummary: getUserAgentSummary(request.headers),
    })
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    return getRouteErrorResponse(error)
  }
}
