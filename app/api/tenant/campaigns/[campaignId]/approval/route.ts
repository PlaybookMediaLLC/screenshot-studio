import { NextRequest, NextResponse } from 'next/server'
import { getRouteErrorResponse } from '@/lib/api/route-errors'
import { requireActiveOrganizationPermission } from '@/lib/auth/access'
import { campaignPostTransitions } from '@/lib/tenant/campaign-status'
import { transitionCampaignPosts } from '@/lib/tenant/campaigns'
import { campaignApprovalSchema } from '@/lib/tenant/schemas'

type RouteContext = { params: Promise<{ campaignId: string }> }

export async function POST(
  request: NextRequest,
  routeContext: RouteContext
): Promise<NextResponse> {
  try {
    const { campaignId } = await routeContext.params
    const input = campaignApprovalSchema.parse(await request.json())
    const context = await requireActiveOrganizationPermission(
      request.headers,
      campaignPostTransitions[input.decision].permission
    )
    const result = await transitionCampaignPosts(context, campaignId, input.decision, input.postIds)
    return NextResponse.json(result)
  } catch (error) {
    return getRouteErrorResponse(error)
  }
}
