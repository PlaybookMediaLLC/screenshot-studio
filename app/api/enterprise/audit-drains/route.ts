import { NextRequest, NextResponse } from 'next/server'
import { appendAuditLog } from '@/lib/audit/log'
import { toAuditDrainResponse } from '@/lib/audit/drain-response'
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
import { getAuditActor } from '@/lib/auth/principal'
import { getRouteErrorResponse } from '@/lib/api/route-errors'
import { prisma } from '@/lib/db'

function getListInput(request: NextRequest) {
  return auditDrainListSchema.parse(Object.fromEntries(request.nextUrl.searchParams))
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const input = getListInput(request)
    await requireOrganizationPermission(request.headers, input.organizationId, 'audit:read')
    const drains = await prisma.auditDrain.findMany({
      orderBy: { createdAt: 'desc' },
      where: { organizationId: input.organizationId },
    })
    return NextResponse.json({ drains: drains.map(toAuditDrainResponse) })
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
    const drain = await prisma.$transaction(async (transaction) => {
      const createdDrain = await transaction.auditDrain.create({
        data: {
          encryptedSigningSecret: encryptDrainSecret(input.signingSecret),
          endpoint: input.endpoint,
          name: input.name,
          organizationId: access.organizationId,
          provider: input.provider,
        },
      })
      await appendAuditLog(transaction, {
        action: 'audit.drain_created',
        actor: getAuditActor(access.principal),
        entityId: createdDrain.id,
        entityType: 'audit_drain',
        ipHash: getAuditIpHash(request.headers),
        metadata: { name: input.name, provider: input.provider },
        organizationId: access.organizationId,
        requestId: access.requestId,
        userAgentSummary: getUserAgentSummary(request.headers),
      })
      return createdDrain
    })
    return NextResponse.json({ drain: toAuditDrainResponse(drain) }, { status: 201 })
  } catch (error) {
    return getRouteErrorResponse(error)
  }
}
