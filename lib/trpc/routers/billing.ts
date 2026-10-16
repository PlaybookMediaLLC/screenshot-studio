import 'server-only'

import { backendSDK } from '@/lib/backend/sdk'
import { getWorkspaceQuota, workspacePlanSchema } from '@/lib/billing/plans'
import { consumeWorkspaceQuota, WorkspaceQuotaError } from '@/lib/tenant/entitlements'
import { router } from '../init'
import { organizationProcedure } from '../procedures'

/** The workspace's plan and AI credits, for the Billing settings page. */
export const billingRouter = router({
  summary: organizationProcedure('workspace:read').query(async ({ ctx }) => {
    const sdk = backendSDK(ctx.access)
    const entitlements = await sdk.getEntitlements()
    const plan = workspacePlanSchema.catch(workspacePlanSchema.enum.free).parse(entitlements.plan)
    const creditsLeft = await consumeWorkspaceQuota(ctx.access, 'ai:credits:monthly', 0).catch(
      (error: unknown) => {
        if (error instanceof WorkspaceQuotaError) return 0
        throw error
      }
    )
    // The grace date is in the owner's sensitive contract view, which needs a
    // fresh two-factor session; without one the page shows no date.
    const graceUntil =
      entitlements.status === 'past_due' && ctx.access.role === 'owner'
        ? await sdk
            .getWorkspaceEntitlement()
            .then(({ entitlement }) => entitlement.graceUntil)
            .catch(() => null)
        : null
    return {
      creditsLeft,
      graceUntil,
      monthlyCredits: getWorkspaceQuota(plan, 'ai:credits:monthly'),
      paid: entitlements.features['workspace:use'] === true,
      plan,
      status: entitlements.status,
    }
  }),
})
