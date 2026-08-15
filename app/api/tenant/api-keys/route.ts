import { NextRequest, NextResponse } from 'next/server'
import { appendAuditLog } from '@/lib/audit/log'
import { apiKeyScopePermissions } from '@/lib/auth/api-key-scopes'
import { requireActiveOrganizationPermission } from '@/lib/auth/access'
import { getAuditActor } from '@/lib/auth/principal'
import { auth } from '@/lib/auth/server'
import { prisma } from '@/lib/db'
import { getRouteErrorResponse } from '@/lib/api/route-errors'
import {
  workspaceApiKeyDeleteSchema,
  workspaceApiKeySchema,
} from '@/lib/tenant/workspace-settings-schema'

const dayInSeconds = 24 * 60 * 60

function getPermissions(scopes: readonly (keyof typeof apiKeyScopePermissions)[]) {
  return scopes.reduce<Record<string, string[]>>((permissions, scope) => {
    const [resource, actions] = Object.entries(apiKeyScopePermissions[scope])[0] ?? []
    if (resource && actions) permissions[resource] = actions
    return permissions
  }, {})
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const access = await requireActiveOrganizationPermission(request.headers, 'brand:manage')
    const keys = await prisma.apikey.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        createdAt: true,
        enabled: true,
        expiresAt: true,
        id: true,
        name: true,
        prefix: true,
        start: true,
      },
      where: { referenceId: access.organizationId },
    })
    return NextResponse.json({ keys })
  } catch (error) {
    return getRouteErrorResponse(error)
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const input = workspaceApiKeySchema.parse(await request.json())
    const access = await requireActiveOrganizationPermission(request.headers, 'brand:manage')
    const apiKey = await auth.api.createApiKey({
      body: {
        expiresIn: input.expiresInDays ? input.expiresInDays * dayInSeconds : null,
        name: input.name,
        organizationId: access.organizationId,
        permissions: getPermissions(input.scopes),
        userId: access.principal.userId,
      },
    })
    await prisma.$transaction((transaction) =>
      appendAuditLog(transaction, {
        action: 'product.api_key_created',
        actor: getAuditActor(access.principal),
        entityId: apiKey.id,
        entityType: 'api_key',
        organizationId: access.organizationId,
        requestId: access.requestId,
      })
    )
    return NextResponse.json({ apiKey }, { status: 201 })
  } catch (error) {
    return getRouteErrorResponse(error)
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    const input = workspaceApiKeyDeleteSchema.parse(await request.json())
    const access = await requireActiveOrganizationPermission(request.headers, 'brand:manage')
    await prisma.$transaction(async (transaction) => {
      const key = await transaction.apikey.findFirst({
        select: { id: true },
        where: { id: input.keyId, referenceId: access.organizationId },
      })
      if (!key) return
      await transaction.apikey.delete({ where: { id: key.id } })
      await appendAuditLog(transaction, {
        action: 'product.api_key_revoked',
        actor: getAuditActor(access.principal),
        entityId: key.id,
        entityType: 'api_key',
        organizationId: access.organizationId,
        requestId: access.requestId,
      })
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    return getRouteErrorResponse(error)
  }
}
