import 'server-only'

import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { getDesign } from '@/lib/tenant/designs'
import { router } from '../init'
import { organizationProcedure } from '../procedures'

export const designRouter = router({
  /** The full document, for opening a design in the editor. */
  get: organizationProcedure('artifact:read')
    .input(z.object({ designId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const design = await getDesign(ctx.access.organizationId, input.designId)
      if (!design) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Design not found.' })
      }
      return { design }
    }),
})
