import { NextRequest, NextResponse } from 'next/server'
import { getRouteErrorResponse } from '@/lib/api/route-errors'
import { requireActiveOrganizationPermission } from '@/lib/auth/access'
import { prisma } from '@/lib/db'
import { createBrandKit } from '@/lib/tenant/configuration'
import { brandKitCreateSchema } from '@/lib/tenant/schemas'

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const context = await requireActiveOrganizationPermission(request.headers, 'brand:manage')
    const brandKits = await prisma.brandKit.findMany({
      orderBy: [{ name: 'asc' }, { version: 'desc' }],
      select: {
        createdAt: true,
        definition: true,
        id: true,
        name: true,
        status: true,
        version: true,
      },
      where: { organizationId: context.organizationId },
    })
    return NextResponse.json({ brandKits })
  } catch (error) {
    return getRouteErrorResponse(error)
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const context = await requireActiveOrganizationPermission(request.headers, 'brand:manage')
    const input = brandKitCreateSchema.parse(await request.json())
    const brandKit = await createBrandKit(context, input)
    return NextResponse.json({ brandKit }, { status: 201 })
  } catch (error) {
    return getRouteErrorResponse(error)
  }
}
