import 'server-only'

import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import {
  createProductSurface,
  deleteProductSurface,
  listProductSurfaces,
  updateProductSurface,
} from '@/lib/tenant/product-surfaces'
import { productSurfaceCreateSchema, productSurfaceUpdateSchema } from '@/lib/tenant/schemas'
import { router } from '../init'
import { organizationProcedure } from '../procedures'

const surfaceIdSchema = z.string().cuid()

export const productSurfaceRouter = router({
  list: organizationProcedure('brand:manage').query(async ({ ctx }) => {
    const productSurfaces = await listProductSurfaces(ctx.access.organizationId)
    return { productSurfaces }
  }),
  create: organizationProcedure('brand:manage')
    .input(productSurfaceCreateSchema)
    .mutation(async ({ ctx, input }) => {
      const productSurface = await createProductSurface(ctx.access, input)
      return { productSurface }
    }),
  update: organizationProcedure('brand:manage')
    .input(productSurfaceUpdateSchema.extend({ surfaceId: surfaceIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const { surfaceId, ...update } = input
      const productSurface = await updateProductSurface(ctx.access, surfaceId, update)
      if (!productSurface) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Product surface not found.' })
      }
      return { productSurface }
    }),
  delete: organizationProcedure('brand:manage')
    .input(z.object({ surfaceId: surfaceIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const deleted = await deleteProductSurface(ctx.access, input.surfaceId)
      if (!deleted) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Product surface not found.' })
      }
      return { deleted: true as const }
    }),
})
