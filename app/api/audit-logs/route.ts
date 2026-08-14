import { NextRequest, NextResponse } from 'next/server'
import { appendAuditLog } from '@/lib/audit/log'
import { getAuditIpHash, getUserAgentSummary } from '@/lib/audit/request'
import { auditLogQuerySchema, listAuditLogs } from '@/lib/audit/query'
import { requireOrganizationPermission } from '@/lib/auth/access'
import { getAuditActor } from '@/lib/auth/principal'
import { prisma } from '@/lib/db'
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
    const page = await listAuditLogs(input)
    await prisma.$transaction((transaction) =>
      appendAuditLog(transaction, {
        action: 'audit.log_read',
        actor: getAuditActor(access.principal),
        entityType: 'audit_log',
        ipHash: getAuditIpHash(request.headers),
        metadata: { resultCount: page.items.length },
        organizationId: access.organizationId,
        requestId: access.requestId,
        userAgentSummary: getUserAgentSummary(request.headers),
      })
    )
    return NextResponse.json(page)
  } catch (error) {
    return getRouteErrorResponse(error)
  }
}
