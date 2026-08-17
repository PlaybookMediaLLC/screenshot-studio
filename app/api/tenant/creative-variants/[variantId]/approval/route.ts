import { NextRequest, NextResponse } from 'next/server'
import { getRouteErrorResponse } from '@/lib/api/route-errors'
import { requireActiveOrganizationPermission } from '@/lib/auth/access'
import { decideCreativeVariantApproval } from '@/lib/tenant/creative'
import { creativeVariantApprovalSchema } from '@/lib/tenant/schemas'

type RouteContext = { params: Promise<{ variantId: string }> }

export async function POST(
  request: NextRequest,
  routeContext: RouteContext
): Promise<NextResponse> {
  try {
    const context = await requireActiveOrganizationPermission(request.headers, 'release:approve')
    const { variantId } = await routeContext.params
    const result = await decideCreativeVariantApproval(
      context,
      variantId,
      creativeVariantApprovalSchema.parse(await request.json())
    )
    return NextResponse.json(result)
  } catch (error) {
    return getRouteErrorResponse(error)
  }
}
