import { rerunOnboardingRunContract } from '@/lib/api/contracts/onboarding-runs'
import { route } from '@/lib/api/route'
import { tenantAccess } from '@/lib/api/route-auth'
import { rerunOnboardingRun } from '@/lib/tenant/onboarding-runs'

/** Start a new run for a run's URL; an unchanged site costs nothing. */
export const POST = route(rerunOnboardingRunContract, {
  auth: tenantAccess({ apiKeyScope: 'onboarding:run', permission: 'workspace:update' }),
  handler: async ({ access, headers, params }) =>
    rerunOnboardingRun(access, params.runId, headers['idempotency-key'] || undefined),
  status: (result) => (result.created ? 201 : 200),
})
