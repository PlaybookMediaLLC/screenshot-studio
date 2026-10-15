import { NextRequest, NextResponse } from 'next/server'
import { getRouteErrorResponse } from '@/lib/api/route-errors'
import {
  requireActiveOrganizationPermission,
  requireSensitiveOrganizationPermission,
} from '@/lib/auth/access'
import { backendSDK } from '@/lib/backend/sdk'

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const active = await requireActiveOrganizationPermission(request.headers, 'workspace:delete')
    const access = await requireSensitiveOrganizationPermission(
      request.headers,
      active.organizationId,
      'workspace:delete'
    )
    return NextResponse.json(await backendSDK(access).getWorkspaceEntitlement())
  } catch (error) {
    return getRouteErrorResponse(error)
  }
}
