import { createBillingSessionContract } from '@/lib/api/contracts/billing'
import { route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { backendSDK } from '@/lib/backend/sdk'
import { createBillingSession } from '@/lib/billing/stripe'

/** Workspace admins start a subscription, or manage the one they have. */
export const POST = route(createBillingSessionContract, {
  auth: organizationAccess('workspace:update'),
  handler: async ({ access, body }) => {
    const { plan } = await backendSDK(access).getEntitlements()
    return createBillingSession({
      currentPlan: plan,
      interval: body.interval,
      organizationId: access.organizationId,
      plan: body.plan,
    })
  },
})
