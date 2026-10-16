import { createCreditPackSessionContract } from '@/lib/api/contracts/billing'
import { errorResponse, route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { createCreditPackSession } from '@/lib/billing/stripe'
import { requireWorkspaceFeature, WorkspaceEntitlementError } from '@/lib/tenant/entitlements'

/** Workspace admins on a paid plan buy extra AI credits. */
export const POST = route(createCreditPackSessionContract, {
  auth: organizationAccess('workspace:update'),
  handler: async ({ access, body }) => {
    try {
      await requireWorkspaceFeature(access, 'workspace:use')
    } catch (error) {
      if (!(error instanceof WorkspaceEntitlementError)) throw error
      return errorResponse(403, 'Subscribe to a plan first.', {
        code: 'workspace_feature_not_entitled',
      })
    }
    return createCreditPackSession({ organizationId: access.organizationId, pack: body.pack })
  },
})
