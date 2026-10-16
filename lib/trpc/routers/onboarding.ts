import 'server-only'

import { z } from 'zod'
import { readProductSite } from '@/lib/ai/onboarding/product-profile'
import { startFirstCampaign } from '@/lib/onboarding/first-campaign'
import { productProfileValuesSchema } from '@/lib/tenant/product-profile-schema'
import { router } from '../init'
import { organizationProcedure } from '../procedures'
import { allowAiAction } from './launch'

/**
 * Onboarding's product step: read the product's site into a profile, then
 * start the first campaign from the confirmed profile.
 */
export const onboardingRouter = router({
  /** The fast path: about 20 seconds, charged AI credits for its one model call. */
  readSite: organizationProcedure('brand:manage')
    .input(
      z.object({
        sentence: z.string().trim().max(300).optional(),
        url: productProfileValuesSchema.shape.url,
      })
    )
    .mutation(async ({ ctx, input }) => {
      await allowAiAction(ctx.access)
      return readProductSite(ctx.access, input)
    }),
  /** Create the product surface, release brief, and campaign the first posts come from. */
  startCampaign: organizationProcedure('brand:manage')
    .input(z.object({ pages: z.array(productProfileValuesSchema.shape.url).max(10).default([]) }))
    .mutation(async ({ ctx, input }) => startFirstCampaign(ctx.access, input.pages)),
})
