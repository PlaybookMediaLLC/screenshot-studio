import 'server-only'

import { prisma } from '@/lib/db'
import {
  createBrandKit,
  createSourceApp,
  getBrandProfile,
  upsertBrandProfile,
} from '@/lib/tenant/configuration'
import {
  brandKitCreateSchema,
  brandProfileUpsertSchema,
  sourceAppCreateSchema,
} from '@/lib/tenant/schemas'
import { router } from '../init'
import { organizationProcedure, tenantProcedure } from '../procedures'

export const brandKitRouter = router({
  list: organizationProcedure('brand:manage').query(async ({ ctx }) => {
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
      where: { organizationId: ctx.access.organizationId },
    })
    return { brandKits }
  }),
  create: organizationProcedure('brand:manage')
    .input(brandKitCreateSchema)
    .mutation(async ({ ctx, input }) => {
      const brandKit = await createBrandKit(ctx.access, input)
      return { brandKit }
    }),
})

export const brandProfileRouter = router({
  get: organizationProcedure('brand:manage').query(async ({ ctx }) => {
    const brandProfile = await getBrandProfile(ctx.access.organizationId)
    return { brandProfile }
  }),
  upsert: organizationProcedure('brand:manage')
    .input(brandProfileUpsertSchema)
    .mutation(async ({ ctx, input }) => {
      const brandProfile = await upsertBrandProfile(ctx.access, input)
      return { brandProfile }
    }),
})

export const sourceAppRouter = router({
  create: tenantProcedure({ apiKeyScope: 'source:write', permission: 'brand:manage' })
    .input(sourceAppCreateSchema)
    .mutation(async ({ ctx, input }) => {
      const sourceApp = await createSourceApp(ctx.tenant, input)
      return { sourceApp }
    }),
})
