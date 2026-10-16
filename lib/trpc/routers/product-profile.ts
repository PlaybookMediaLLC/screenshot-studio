import 'server-only'

import { getProductProfile, upsertProductProfile } from '@/lib/tenant/product-profile'
import {
  productProfileSourceSchema,
  productProfileUpsertSchema,
} from '@/lib/tenant/product-profile-schema'
import { router } from '../init'
import { organizationProcedure } from '../procedures'

/** The workspace's product profile (docs/rfcs/012-product-intelligence.md). */
export const productProfileRouter = router({
  get: organizationProcedure('workspace:read').query(async ({ ctx }) => ({
    productProfile: await getProductProfile(ctx.access),
  })),
  /** A person's edit: each changed field is locked against automated updates. */
  upsert: organizationProcedure('brand:manage')
    .input(productProfileUpsertSchema)
    .mutation(async ({ ctx, input }) => ({
      productProfile: await upsertProductProfile(ctx.access, {
        ...input,
        source: productProfileSourceSchema.enum.manual,
      }),
    })),
})
