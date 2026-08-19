import 'server-only'

import { z } from 'zod'
import { prisma } from '@/lib/db'
import {
  createCreativeTemplate,
  createCreativeVariant,
  decideCreativeVariantApproval,
} from '@/lib/tenant/creative'
import {
  creativeTemplateCreateSchema,
  creativeVariantApprovalSchema,
  creativeVariantCreateSchema,
} from '@/lib/tenant/schemas'
import { router } from '../init'
import { organizationProcedure } from '../procedures'

export const creativeTemplateRouter = router({
  list: organizationProcedure('artifact:read').query(async ({ ctx }) => {
    const templates = await prisma.creativeTemplate.findMany({
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
    return { templates }
  }),
  create: organizationProcedure('artifact:edit')
    .input(creativeTemplateCreateSchema)
    .mutation(async ({ ctx, input }) => {
      const template = await createCreativeTemplate(ctx.access, input)
      return { template }
    }),
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
