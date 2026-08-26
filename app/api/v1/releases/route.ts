import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createTenantJsonRoute } from '@/lib/api/v1/route'
import { createRelease, listReleases } from '@/lib/tenant/releases'
import { releaseCreateSchema, releaseListQuerySchema } from '@/lib/tenant/schemas'

export const GET = createTenantJsonRoute({
  access: { apiKeyScope: 'artifact:read', permission: 'artifact:read' },
  parse: (request) =>
    releaseListQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams)),
  execute: async (tenant, input) => ({
    releases: await listReleases(tenant.organizationId, input.limit),
  }),
})

export const POST = createTenantJsonRoute({
  access: { apiKeyScope: 'release:create', permission: 'release:create' },
  parse: async (request) => ({
    input: releaseCreateSchema.parse(await request.json()),
    idempotencyKey: request.headers.get('idempotency-key')?.slice(0, 128) || randomUUID(),
  }),
  execute: (tenant, { input, idempotencyKey }) =>
    createRelease(tenant, { ...input, idempotencyKey }),
  respond: (result) => NextResponse.json(result, { status: result.created ? 201 : 200 }),
})
