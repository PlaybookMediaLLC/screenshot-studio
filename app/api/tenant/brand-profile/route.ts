import { NextRequest, NextResponse } from 'next/server'
import { getRouteErrorResponse } from '@/lib/api/route-errors'
import { requireActiveOrganizationPermission } from '@/lib/auth/access'
import { getBrandProfile, upsertBrandProfile } from '@/lib/tenant/configuration'
import { brandProfileUpsertSchema } from '@/lib/tenant/schemas'

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const context = await requireActiveOrganizationPermission(request.headers, 'brand:manage')
    const brandProfile = await getBrandProfile(context.organizationId)
    return NextResponse.json({ brandProfile })
  } catch (error) {
    return getRouteErrorResponse(error)
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  try {
    const context = await requireActiveOrganizationPermission(request.headers, 'brand:manage')
    const input = brandProfileUpsertSchema.parse(await request.json())
    const brandProfile = await upsertBrandProfile(context, input)
    return NextResponse.json({ brandProfile })
  } catch (error) {
    return getRouteErrorResponse(error)
  }
}
