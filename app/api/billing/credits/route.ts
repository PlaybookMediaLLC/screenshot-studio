import { createCreditPackSessionContract } from '@/lib/api/contracts/billing'
import { route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { createCreditPackSession } from '@/lib/billing/stripe'

/** Workspace admins buy extra AI credits on any plan. */
export const POST = route(createCreditPackSessionContract, {
  auth: organizationAccess('workspace:update'),
  handler: async ({ access, body }) =>
    createCreditPackSession({ organizationId: access.organizationId, pack: body.pack }),
})
