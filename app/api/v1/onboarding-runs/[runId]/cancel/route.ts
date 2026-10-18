import { cancelOnboardingRunContract } from '@/lib/api/contracts/onboarding-runs'
import { route } from '@/lib/api/route'
import { tenantAccess } from '@/lib/api/route-auth'
import { cancelOnboardingRun } from '@/lib/tenant/onboarding-runs'

/** Stop a run within seconds; what it read is kept. */
export const POST = route(cancelOnboardingRunContract, {
  auth: tenantAccess({ apiKeyScope: 'onboarding:run', permission: 'workspace:update' }),
  handler: async ({ access, params }) => ({ run: await cancelOnboardingRun(access, params.runId) }),
})
