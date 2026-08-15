import { NextRequest, NextResponse } from 'next/server'
import { getRouteErrorResponse } from '@/lib/api/route-errors'
import { requireActiveOrganizationPermission } from '@/lib/auth/access'
import { createCreativeVariant } from '@/lib/tenant/creative'
import { creativeVariantCreateSchema } from '@/lib/tenant/schemas'

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const context = await requireActiveOrganizationPermission(request.headers, 'artifact:edit')
    const variant = await createCreativeVariant(
      context,
      creativeVariantCreateSchema.parse(await request.json())
    )
    return NextResponse.json({ variant }, { status: 201 })
  } catch (error) {
    return getRouteErrorResponse(error)
  }
}
