import 'server-only'

import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { createRelease, listReleases } from '@/lib/tenant/releases'
import { releaseCreateSchema, releaseListQuerySchema } from '@/lib/tenant/schemas'
import { router } from '../init'
import { tenantProcedure } from '../procedures'

const idempotencyKeySchema = z.string().trim().min(1).max(128).optional()

export const releaseRouter = router({
  list: tenantProcedure({ apiKeyScope: 'artifact:read', permission: 'artifact:read' })
    .input(releaseListQuerySchema.optional())
    .query(async ({ ctx, input }) => {
      const releases = await listReleases(ctx.tenant.organizationId, input?.limit ?? 50)
      return { releases }
    }),
  create: tenantProcedure({ apiKeyScope: 'release:create', permission: 'release:create' })
    .input(releaseCreateSchema.extend({ idempotencyKey: idempotencyKeySchema }))
    .mutation(async ({ ctx, input }) => {
      const { idempotencyKey, ...release } = input
      return createRelease(ctx.tenant, {
        ...release,
        idempotencyKey: idempotencyKey ?? randomUUID(),
      })
    }),
})
