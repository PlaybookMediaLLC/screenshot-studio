import { NextRequest, NextResponse } from 'next/server'
import { getRouteErrorResponse } from '@/lib/api/route-errors'
import { requireActiveOrganizationPermission } from '@/lib/auth/access'
import { createProductSurface, listProductSurfaces } from '@/lib/tenant/product-surfaces'
import { productSurfaceCreateSchema } from '@/lib/tenant/schemas'

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const context = await requireActiveOrganizationPermission(request.headers, 'brand:manage')
    const productSurfaces = await listProductSurfaces(context.organizationId)
    return NextResponse.json({ productSurfaces })
  } catch (error) {
    return getRouteErrorResponse(error)
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const context = await requireActiveOrganizationPermission(request.headers, 'brand:manage')
    const input = productSurfaceCreateSchema.parse(await request.json())
    const productSurface = await createProductSurface(context, input)
    return NextResponse.json({ productSurface }, { status: 201 })
  } catch (error) {
    return getRouteErrorResponse(error)
  }
}
