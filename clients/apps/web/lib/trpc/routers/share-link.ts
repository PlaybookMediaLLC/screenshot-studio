import 'server-only'

import { z } from 'zod'
import type { TenantAccessRequirement } from '@/lib/api/access-requirements'
import { shareLinkCreateSchema, shareLinkUpdateSchema } from '@/lib/sharing/schema'
import {
  createShareLink,
  listShareLinks,
  revokeShareLink,
  updateShareLink,
} from '@/lib/sharing/server'
import { router } from '../init'
import { tenantProcedure } from '../procedures'

const READ: TenantAccessRequirement = { apiKeyScope: 'artifact:read', permission: 'artifact:read' }
const EDIT: TenantAccessRequirement = { apiKeyScope: 'asset:write', permission: 'artifact:edit' }

/** Share links: publish an export at a URL, change its access, and revoke it. */
export const shareLinkRouter = router({
  list: tenantProcedure(READ).query(async ({ ctx }) => ({
    shareLinks: await listShareLinks(ctx.tenant),
  })),
  create: tenantProcedure(EDIT)
    .input(shareLinkCreateSchema)
    .mutation(async ({ ctx, input }) => ({ shareLink: await createShareLink(ctx.tenant, input) })),
  update: tenantProcedure(EDIT)
    .input(shareLinkUpdateSchema)
    .mutation(async ({ ctx, input }) => ({ shareLink: await updateShareLink(ctx.tenant, input) })),
  revoke: tenantProcedure(EDIT)
    .input(z.object({ id: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      await revokeShareLink(ctx.tenant, input.id)
      return { revoked: true as const }
    }),
})
