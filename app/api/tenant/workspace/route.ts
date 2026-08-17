import { NextRequest, NextResponse } from 'next/server'
import { appendAuditLog } from '@/lib/audit/log'
import { requireActiveOrganizationPermission } from '@/lib/auth/access'
import { getAuditActor } from '@/lib/auth/principal'
import { prisma } from '@/lib/db'
import { getRouteErrorResponse } from '@/lib/api/route-errors'
import { workspaceUpdateSchema } from '@/lib/tenant/workspace-settings-schema'

export async function PUT(request: NextRequest): Promise<NextResponse> {
  try {
    const input = workspaceUpdateSchema.parse(await request.json())
    const access = await requireActiveOrganizationPermission(request.headers, 'member:manage')
    const organization = await prisma.$transaction(async (transaction) => {
      const updated = await transaction.organization.update({
        data: input,
        where: { id: access.organizationId },
      })
      await appendAuditLog(transaction, {
        action: 'product.workspace_updated',
        actor: getAuditActor(access.principal),
        entityId: updated.id,
        entityType: 'organization',
        organizationId: access.organizationId,
        requestId: access.requestId,
      })
      return updated
    })
    return NextResponse.json({ organization })
  } catch (error) {
    return getRouteErrorResponse(error)
  }
}
