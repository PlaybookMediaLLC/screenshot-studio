import { NextRequest, NextResponse } from 'next/server'
import { getRouteErrorResponse } from '@/lib/api/route-errors'
import { requireActiveOrganizationPermission } from '@/lib/auth/access'
import { scheduleCampaignPost } from '@/lib/tenant/campaigns'
import { campaignPostScheduleSchema } from '@/lib/tenant/schemas'

type RouteContext = { params: Promise<{ campaignId: string; postId: string }> }

export async function POST(
  request: NextRequest,
  routeContext: RouteContext
): Promise<NextResponse> {
  try {
    const { campaignId, postId } = await routeContext.params
    const context = await requireActiveOrganizationPermission(request.headers, 'publish:manage')
    const input = campaignPostScheduleSchema.parse(await request.json())
    const post = await scheduleCampaignPost(context, campaignId, postId, input)
    return NextResponse.json({ post })
  } catch (error) {
    return getRouteErrorResponse(error)
  }
}
