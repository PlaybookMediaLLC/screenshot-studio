import { NextRequest, NextResponse } from 'next/server'
import { appendAuditLog } from '@/lib/audit/log'
import { auditDrainListSchema } from '@/lib/audit/drain-schema'
import { getAuditIpHash, getUserAgentSummary } from '@/lib/audit/request'
import { requireSensitiveOrganizationPermission } from '@/lib/auth/access'
import { getAuditActor } from '@/lib/auth/principal'
import { getRouteErrorResponse } from '@/lib/api/route-errors'
import { prisma } from '@/lib/db'

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
    const drain = await prisma.auditDrain.findFirst({
      where: { id: drainId, organizationId: access.organizationId },
    })
    if (!drain) {
      return NextResponse.json({ error: 'Audit drain not found.' }, { status: 404 })
    }
    await prisma.$transaction(async (transaction) => {
      await transaction.auditDrain.delete({ where: { id: drain.id } })
      await appendAuditLog(transaction, {
        action: 'audit.drain_deleted',
        actor: getAuditActor(access.principal),
        entityId: drain.id,
        entityType: 'audit_drain',
        ipHash: getAuditIpHash(request.headers),
        metadata: { name: drain.name, provider: drain.provider },
        organizationId: access.organizationId,
        requestId: access.requestId,
        userAgentSummary: getUserAgentSummary(request.headers),
      })
    })
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    return getRouteErrorResponse(error)
  }
}
