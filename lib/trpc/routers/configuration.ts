import 'server-only'

import { hasPermission } from '@/lib/auth/permissions'
import {
  archiveBrandKit,
  createBrandKit,
  createSourceApp,
  getBrandProfile,
  listBrandKits,
  renameBrandKit,
  upsertBrandProfile,
} from '@/lib/tenant/configuration'
import {
  brandKitCreateSchema,
  brandProfileUpsertSchema,
  libraryArchiveSchema,
  libraryRenameSchema,
  sourceAppCreateSchema,
} from '@/lib/tenant/schemas'
import { getSourceWebhookSetup } from '@/lib/tenant/webhooks'
import { router } from '../init'
import { organizationProcedure, tenantProcedure } from '../procedures'

export const brandKitRouter = router({
  // Every member reads brand kits to apply them; managing them needs brand:manage.
  list: organizationProcedure('artifact:read').query(async ({ ctx }) => {
    const brandKits = await listBrandKits(ctx.access)
    return { brandKits, canManage: hasPermission(ctx.access.role, 'brand:manage') }
  }),
  create: organizationProcedure('brand:manage')
    .input(brandKitCreateSchema)
    .mutation(async ({ ctx, input }) => {
      const brandKit = await createBrandKit(ctx.access, input)
      return { brandKit }
    }),
  rename: organizationProcedure('brand:manage')
    .input(libraryRenameSchema)
    .mutation(async ({ ctx, input }) => ({
      brandKit: await renameBrandKit(ctx.access, input.id, input.name),
    })),
  archive: organizationProcedure('brand:manage')
    .input(libraryArchiveSchema)
    .mutation(({ ctx, input }) => archiveBrandKit(ctx.access, input.id)),
})

export const brandProfileRouter = router({
  get: organizationProcedure('brand:manage').query(async ({ ctx }) => {
    const brandProfile = await getBrandProfile(ctx.access)
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
      return { sourceApp, webhook: getSourceWebhookSetup(sourceApp) }
    }),
})
