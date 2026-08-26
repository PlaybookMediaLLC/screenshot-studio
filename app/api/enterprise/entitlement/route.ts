import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getRouteErrorResponse } from '@/lib/api/route-errors'
import {
  requireActiveOrganizationPermission,
  requireSensitiveOrganizationPermission,
} from '@/lib/auth/access'

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const active = await requireActiveOrganizationPermission(request.headers, 'workspace:delete')
    const access = await requireSensitiveOrganizationPermission(
      request.headers,
      active.organizationId,
      'workspace:delete'
    )
    const entitlement = await prisma.workspaceEntitlement.findUnique({
      select: {
        featureOverrides: true,
        graceUntil: true,
        lastSyncedAt: true,
        plan: true,
        status: true,
        validUntil: true,
        version: true,
      },
      where: { organizationId: access.organizationId },
    })
    return NextResponse.json({
      entitlement: entitlement ?? { plan: 'free', status: 'active', version: 0 },
    })
  } catch (error) {
    return getRouteErrorResponse(error)
  }
}
