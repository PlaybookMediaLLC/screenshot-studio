import { NextRequest, NextResponse } from 'next/server'
import { getRouteErrorResponse } from '@/lib/api/route-errors'
import { requireActiveOrganizationPermission } from '@/lib/auth/access'
import { getCampaign } from '@/lib/tenant/campaigns'

type RouteContext = { params: Promise<{ campaignId: string }> }

export async function GET(request: NextRequest, routeContext: RouteContext): Promise<NextResponse> {
  try {
    const { campaignId } = await routeContext.params
    const context = await requireActiveOrganizationPermission(request.headers, 'artifact:read')
    const campaign = await getCampaign(context.organizationId, campaignId)
    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found.' }, { status: 404 })
    }
    return NextResponse.json({ campaign })
  } catch (error) {
    return getRouteErrorResponse(error)
  }
}
