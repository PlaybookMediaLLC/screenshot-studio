import { NextRequest, NextResponse } from 'next/server'
import { appendAuditLog } from '@/lib/audit/log'
import { defaultAuditRetentionDays } from '@/lib/audit/retention'
import { auditRetentionQuerySchema, auditRetentionUpdateSchema } from '@/lib/audit/retention-schema'
import { getAuditIpHash, getUserAgentSummary } from '@/lib/audit/request'
import {
  requireOrganizationPermission,
  requireSensitiveOrganizationPermission,
} from '@/lib/auth/access'
import { getAuditActor } from '@/lib/auth/principal'
import { getRouteErrorResponse } from '@/lib/api/route-errors'
import { prisma } from '@/lib/db'

function getQueryInput(request: NextRequest) {
  return auditRetentionQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams))
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const input = getQueryInput(request)
    await requireOrganizationPermission(request.headers, input.organizationId, 'audit:read')
    const policy = await prisma.auditRetentionPolicy.findUnique({
      where: { organizationId: input.organizationId },
    })
    return NextResponse.json(
      policy ?? { legalHold: false, retentionDays: defaultAuditRetentionDays }
    )
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
    const policy = await prisma.$transaction(async (transaction) => {
      const updatedPolicy = await transaction.auditRetentionPolicy.upsert({
        create: input,
        update: { legalHold: input.legalHold, retentionDays: input.retentionDays },
        where: { organizationId: access.organizationId },
      })
      await appendAuditLog(transaction, {
        action: 'audit.retention_changed',
        actor: getAuditActor(access.principal),
        entityId: access.organizationId,
        entityType: 'audit_retention_policy',
        ipHash: getAuditIpHash(request.headers),
        metadata: { legalHold: input.legalHold, retentionDays: input.retentionDays },
        organizationId: access.organizationId,
        requestId: access.requestId,
        userAgentSummary: getUserAgentSummary(request.headers),
      })
      return updatedPolicy
    })
    return NextResponse.json(policy)
  } catch (error) {
    return getRouteErrorResponse(error)
  }
}
