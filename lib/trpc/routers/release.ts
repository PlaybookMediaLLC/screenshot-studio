import 'server-only'

import { randomUUID } from 'node:crypto'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { createRelease, getRelease, listReleases, updateRelease } from '@/lib/tenant/releases'
import {
  releaseCreateSchema,
  releaseListQuerySchema,
  releaseUpdateSchema,
} from '@/lib/tenant/schemas'
import { router } from '../init'
import { tenantProcedure } from '../procedures'

const idempotencyKeySchema = z.string().trim().min(1).max(128).optional()
const releaseIdSchema = z.string().uuid()

export const releaseRouter = router({
  list: tenantProcedure({ apiKeyScope: 'artifact:read', permission: 'artifact:read' })
    .input(releaseListQuerySchema.optional())
    .query(async ({ ctx, input }) => {
      const releases = await listReleases(ctx.tenant.organizationId, input?.limit ?? 50)
      return { releases }
    }),
  get: tenantProcedure({ apiKeyScope: 'artifact:read', permission: 'artifact:read' })
    .input(z.object({ releaseId: releaseIdSchema }))
    .query(async ({ ctx, input }) => {
      const release = await getRelease(ctx.tenant.organizationId, input.releaseId)
      if (!release) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Release not found.' })
      }
      return { release }
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
  update: tenantProcedure({ apiKeyScope: 'release:create', permission: 'release:create' })
    .input(releaseUpdateSchema.extend({ releaseId: releaseIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const { releaseId, ...update } = input
      const release = await updateRelease(ctx.tenant, releaseId, update)
      return { release }
    }),
})
