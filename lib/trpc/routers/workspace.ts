import 'server-only'

import { appendAuditLog } from '@/lib/audit/log'
import { getAuditActor } from '@/lib/auth/principal'
import { prisma } from '@/lib/db'
import { workspaceUpdateSchema } from '@/lib/tenant/workspace-settings-schema'
import { router } from '../init'
import { organizationProcedure } from '../procedures'

export const workspaceRouter = router({
  update: organizationProcedure('member:manage')
    .input(workspaceUpdateSchema)
    .mutation(async ({ ctx, input }) => {
      const organization = await prisma.$transaction(async (transaction) => {
        const updated = await transaction.organization.update({
          data: input,
          where: { id: ctx.access.organizationId },
        })
        await appendAuditLog(transaction, {
          action: 'product.workspace_updated',
          actor: getAuditActor(ctx.access.principal),
          entityId: updated.id,
          entityType: 'organization',
          organizationId: ctx.access.organizationId,
          requestId: ctx.access.requestId,
        })
        return updated
      })
      return { organization }
    }),
})
