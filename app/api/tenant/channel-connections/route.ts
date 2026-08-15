import { NextRequest, NextResponse } from 'next/server'
import { getRouteErrorResponse } from '@/lib/api/route-errors'
import {
  requireActiveOrganizationPermission,
  requireSensitiveOrganizationPermission,
} from '@/lib/auth/access'
import { prisma } from '@/lib/db'
import { createPostizConnection } from '@/lib/tenant/scheduled-posts'
import { channelConnectionCreateSchema } from '@/lib/tenant/schemas'

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const context = await requireActiveOrganizationPermission(request.headers, 'publish:manage')
    const connections = await prisma.channelConnection.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        createdAt: true,
        externalAccountId: true,
        id: true,
        platform: true,
        provider: true,
        providerSettings: true,
        status: true,
      },
      where: { organizationId: context.organizationId },
    })
    return NextResponse.json({ connections })
  } catch (error) {
    return getRouteErrorResponse(error)
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const input = channelConnectionCreateSchema.parse(await request.json())
    const context = await requireSensitiveOrganizationPermission(
      request.headers,
      (await requireActiveOrganizationPermission(request.headers, 'publish:manage')).organizationId,
      'publish:manage'
    )
    const connection = await createPostizConnection(context, input)
    return NextResponse.json({ connection }, { status: 201 })
  } catch (error) {
    return getRouteErrorResponse(error)
  }
}
