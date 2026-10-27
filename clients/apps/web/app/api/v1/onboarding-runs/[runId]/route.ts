import { getOnboardingRunContract } from '@/lib/api/contracts/onboarding-runs'
import { route } from '@/lib/api/route'
import { tenantAccess } from '@/lib/api/route-auth'
import { getOnboardingRun } from '@/lib/tenant/onboarding-runs'

/** A run's status and live progress. */
export const GET = route(getOnboardingRunContract, {
  auth: tenantAccess(getOnboardingRunContract.access),
  handler: async ({ access, params }) => ({ run: await getOnboardingRun(access, params.runId) }),
})
