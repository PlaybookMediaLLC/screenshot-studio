import { NextRequest, NextResponse } from 'next/server'
import { getRouteErrorResponse } from '@/lib/api/route-errors'
import {
  requireActiveOrganizationPermission,
  requireSensitiveOrganizationPermission,
} from '@/lib/auth/access'
import { cancelScheduledPost } from '@/lib/tenant/scheduled-posts'

type RouteContext = { params: Promise<{ scheduledPostId: string }> }

export async function POST(
  request: NextRequest,
  routeContext: RouteContext
): Promise<NextResponse> {
  try {
    const access = await requireActiveOrganizationPermission(request.headers, 'publish:manage')
    const context = await requireSensitiveOrganizationPermission(
      request.headers,
      access.organizationId,
      'publish:manage'
    )
    const { scheduledPostId } = await routeContext.params
    const scheduledPost = await cancelScheduledPost(context, scheduledPostId)
    return NextResponse.json({ scheduledPost })
  } catch (error) {
    return getRouteErrorResponse(error)
  }
}
