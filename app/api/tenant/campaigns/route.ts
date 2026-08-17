import { NextRequest, NextResponse } from 'next/server'
import { getRouteErrorResponse } from '@/lib/api/route-errors'
import { requireActiveOrganizationPermission } from '@/lib/auth/access'
import { createCampaign, listCampaigns } from '@/lib/tenant/campaigns'
import { campaignCreateSchema } from '@/lib/tenant/schemas'

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const context = await requireActiveOrganizationPermission(request.headers, 'artifact:read')
    const campaigns = await listCampaigns(context.organizationId)
    return NextResponse.json({ campaigns })
  } catch (error) {
    return getRouteErrorResponse(error)
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const context = await requireActiveOrganizationPermission(request.headers, 'release:create')
    const input = campaignCreateSchema.parse(await request.json())
    const campaign = await createCampaign(context, input)
    return NextResponse.json({ campaign }, { status: 201 })
  } catch (error) {
    return getRouteErrorResponse(error)
  }
}
