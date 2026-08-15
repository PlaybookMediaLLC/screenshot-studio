import { NextRequest, NextResponse } from 'next/server'
import { getRouteErrorResponse } from '@/lib/api/route-errors'
import { requireActiveOrganizationPermission } from '@/lib/auth/access'
import { prisma } from '@/lib/db'
import { createCreativeTemplate } from '@/lib/tenant/creative'
import { creativeTemplateCreateSchema } from '@/lib/tenant/schemas'

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const context = await requireActiveOrganizationPermission(request.headers, 'artifact:read')
    const templates = await prisma.creativeTemplate.findMany({
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
    return NextResponse.json({ templates })
  } catch (error) {
    return getRouteErrorResponse(error)
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const context = await requireActiveOrganizationPermission(request.headers, 'artifact:edit')
    const template = await createCreativeTemplate(
      context,
      creativeTemplateCreateSchema.parse(await request.json())
    )
    return NextResponse.json({ template }, { status: 201 })
  } catch (error) {
    return getRouteErrorResponse(error)
  }
}
