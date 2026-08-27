import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createTenantJsonRoute } from '@/lib/api/v1/route'
import { createRelease, listReleases } from '@/lib/tenant/releases'
import { releaseCreateSchema, releaseListQuerySchema } from '@/lib/tenant/schemas'

const releaseCreateRequestSchema = z.object({
  body: releaseCreateSchema,
  idempotencyKey: z.string().max(128),
})

export const GET = createTenantJsonRoute({
  access: { apiKeyScope: 'artifact:read', permission: 'artifact:read' },
  schema: releaseListQuerySchema,
  input: (request) => Object.fromEntries(request.nextUrl.searchParams),
  execute: async (tenant, input) => ({
    releases: await listReleases(tenant.organizationId, input.limit),
  }),
})

export const POST = createTenantJsonRoute({
  access: { apiKeyScope: 'release:create', permission: 'release:create' },
  schema: releaseCreateRequestSchema,
  input: async (request) => ({
    body: await request.json(),
    idempotencyKey: request.headers.get('idempotency-key') || randomUUID(),
  }),
  execute: (tenant, { body, idempotencyKey }) => createRelease(tenant, { ...body, idempotencyKey }),
  respond: (result) => NextResponse.json(result, { status: result.created ? 201 : 200 }),
})
