import 'server-only'

import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { getDesign, listCampaignDesigns } from '@/lib/tenant/designs'
import { router } from '../init'
import { organizationProcedure } from '../procedures'

export const designRouter = router({
  /** The full document, for opening a design in the editor. */
  get: organizationProcedure('artifact:read')
    .input(z.object({ designId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const design = await getDesign(ctx.access, input.designId)
      if (!design) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Design not found.' })
      }
      return { design }
    }),
  /** A campaign's designs, newest first, without documents: what Canvas offers to copy. */
  listForCampaign: organizationProcedure('artifact:read')
    .input(z.object({ campaignId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const designs = await listCampaignDesigns(ctx.access, input.campaignId)
      return {
        designs: designs
          .map((design) => ({
            id: design.id,
            name: design.name,
            createdAt: design.createdAt,
            approved: design.approvedVariant !== null,
            variantLabel: design.variantLabel,
            generated: design.planAssetKey !== null || design.critique !== null,
          }))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
      }
    }),
})
