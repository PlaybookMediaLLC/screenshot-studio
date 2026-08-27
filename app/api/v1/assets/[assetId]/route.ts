import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createTenantJsonRoute } from '@/lib/api/v1/route'
import { deleteAsset } from '@/lib/tenant/assets'

const assetDeleteSchema = z.object({
  assetId: z.string().min(1),
})

export const DELETE = createTenantJsonRoute({
  // No `feature` here on purpose. The `asset:delete` plan gate runs inside
  // `deleteAsset`, after ownership is resolved, so a caller cannot learn that
  // a foreign asset exists by comparing a 403 against a 404.
  access: {
    apiKeyScope: 'asset:write',
    permission: 'artifact:edit',
    quota: 'api:write:minute',
  },
  schema: assetDeleteSchema,
  input: async (_request, context) => context.params,
  execute: (tenant, { assetId }) => deleteAsset(tenant, assetId),
  respond: (result) => {
    if (result === 'not-found') {
      return NextResponse.json({ error: 'Asset not found.' }, { status: 404 })
    }
    if (result === 'in-use') {
      return NextResponse.json({ error: 'Asset is in use by a creative variant.' }, { status: 409 })
    }
    if (result === 'not-ready') {
      return NextResponse.json({ error: 'Only uploaded assets can be deleted.' }, { status: 409 })
    }

    return NextResponse.json({ accepted: true }, { status: 202 })
  },
})
