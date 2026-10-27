import 'server-only'

import { z } from 'zod'
import {
  archiveCreativeTemplate,
  createCreativeTemplate,
  createCreativeVariant,
  decideCreativeVariantApproval,
  listCreativeTemplates,
  renameCreativeTemplate,
} from '@/lib/tenant/creative'
import {
  creativeTemplateCreateSchema,
  creativeVariantApprovalSchema,
  creativeVariantCreateSchema,
  libraryArchiveSchema,
  libraryRenameSchema,
} from '@/lib/tenant/schemas'
import { router } from '../init'
import { organizationProcedure } from '../procedures'

export const creativeTemplateRouter = router({
  list: organizationProcedure('artifact:read').query(async ({ ctx }) => ({
    templates: await listCreativeTemplates(ctx.access),
  })),
  create: organizationProcedure('artifact:edit')
    .input(creativeTemplateCreateSchema)
    .mutation(async ({ ctx, input }) => {
      const template = await createCreativeTemplate(ctx.access, input)
      return { template }
    }),
  rename: organizationProcedure('artifact:edit')
    .input(libraryRenameSchema)
    .mutation(async ({ ctx, input }) => ({
      template: await renameCreativeTemplate(ctx.access, input.id, input.name),
    })),
  archive: organizationProcedure('artifact:edit')
    .input(libraryArchiveSchema)
    .mutation(({ ctx, input }) => archiveCreativeTemplate(ctx.access, input.id)),
})

export const creativeVariantRouter = router({
  create: organizationProcedure('artifact:edit')
    .input(creativeVariantCreateSchema)
    .mutation(async ({ ctx, input }) => {
      const variant = await createCreativeVariant(ctx.access, input)
      return { variant }
    }),
  decideApproval: organizationProcedure('release:approve')
    .input(creativeVariantApprovalSchema.extend({ variantId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const { variantId, ...decision } = input
      return decideCreativeVariantApproval(ctx.access, variantId, decision)
    }),
})
