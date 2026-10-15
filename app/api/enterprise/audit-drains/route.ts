import { NextRequest, NextResponse } from 'next/server'
import {
  auditDrainCreateSchema,
  auditDrainListSchema,
  validateDrainEndpoint,
} from '@/lib/audit/drain-schema'
import { encryptDrainSecret } from '@/lib/audit/drains'
import { getAuditIpHash, getUserAgentSummary } from '@/lib/audit/request'
import {
  requireOrganizationPermission,
  requireSensitiveOrganizationPermission,
} from '@/lib/auth/access'
import { getRouteErrorResponse } from '@/lib/api/route-errors'
import { backendSDK } from '@/lib/backend/sdk'

function getListInput(request: NextRequest) {
  return auditDrainListSchema.parse(Object.fromEntries(request.nextUrl.searchParams))
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const input = getListInput(request)
    const access = await requireOrganizationPermission(
      request.headers,
      input.organizationId,
      'audit:read'
    )
    return NextResponse.json(await backendSDK(access).listAuditDrains())
  } catch (error) {
    return getRouteErrorResponse(error)
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const input = auditDrainCreateSchema.parse(await request.json())
    validateDrainEndpoint(input.endpoint)
    const access = await requireSensitiveOrganizationPermission(
      request.headers,
      input.organizationId,
      'audit:manage'
    )
    const result = await backendSDK(access).createAuditDrain(
      {
        encryptedSigningSecret: encryptDrainSecret(input.signingSecret),
        endpoint: input.endpoint,
        name: input.name,
        provider: input.provider,
      },
      {
        ipHash: getAuditIpHash(request.headers),
        userAgentSummary: getUserAgentSummary(request.headers),
      }
    )
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    return getRouteErrorResponse(error)
  }
}
