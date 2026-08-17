import { NextRequest, NextResponse } from 'next/server'
import { getRouteErrorResponse } from '@/lib/api/route-errors'
import { requireActiveOrganizationPermission } from '@/lib/auth/access'
import { deleteProductSurface, updateProductSurface } from '@/lib/tenant/product-surfaces'
import { productSurfaceUpdateSchema } from '@/lib/tenant/schemas'

type RouteContext = { params: Promise<{ surfaceId: string }> }

export async function PATCH(
  request: NextRequest,
  routeContext: RouteContext
): Promise<NextResponse> {
  try {
    const { surfaceId } = await routeContext.params
    const context = await requireActiveOrganizationPermission(request.headers, 'brand:manage')
    const input = productSurfaceUpdateSchema.parse(await request.json())
    const productSurface = await updateProductSurface(context, surfaceId, input)
    if (!productSurface) {
      return NextResponse.json({ error: 'Product surface not found.' }, { status: 404 })
    }
    return NextResponse.json({ productSurface })
  } catch (error) {
    return getRouteErrorResponse(error)
  }
}

export async function DELETE(
  request: NextRequest,
  routeContext: RouteContext
): Promise<NextResponse> {
  try {
    const { surfaceId } = await routeContext.params
    const context = await requireActiveOrganizationPermission(request.headers, 'brand:manage')
    const deleted = await deleteProductSurface(context, surfaceId)
    if (!deleted) {
      return NextResponse.json({ error: 'Product surface not found.' }, { status: 404 })
    }
    return NextResponse.json({ deleted: true })
  } catch (error) {
    return getRouteErrorResponse(error)
  }
}
