import { NextRequest, NextResponse } from 'next/server'
import { auditRetentionQuerySchema, auditRetentionUpdateSchema } from '@/lib/audit/retention-schema'
import { getAuditIpHash, getUserAgentSummary } from '@/lib/audit/request'
import {
  requireOrganizationPermission,
  requireSensitiveOrganizationPermission,
} from '@/lib/auth/access'
import { getRouteErrorResponse } from '@/lib/api/route-errors'
import { backendSDK } from '@/lib/backend/sdk'

function getQueryInput(request: NextRequest) {
  return auditRetentionQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams))
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const input = getQueryInput(request)
    const access = await requireOrganizationPermission(
      request.headers,
      input.organizationId,
      'audit:read'
    )
    return NextResponse.json(await backendSDK(access).getAuditRetention())
  } catch (error) {
    return getRouteErrorResponse(error)
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  try {
    const input = auditRetentionUpdateSchema.parse(await request.json())
    const access = await requireSensitiveOrganizationPermission(
      request.headers,
      input.organizationId,
      'audit:manage'
    )
    const policy = await backendSDK(access).updateAuditRetention(
      { legalHold: input.legalHold, retentionDays: input.retentionDays },
      {
        ipHash: getAuditIpHash(request.headers),
        userAgentSummary: getUserAgentSummary(request.headers),
      }
    )
    return NextResponse.json(policy)
  } catch (error) {
    return getRouteErrorResponse(error)
  }
}
