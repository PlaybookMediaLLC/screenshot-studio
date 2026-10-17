import { createOnboardingRunContract } from '@/lib/api/contracts/onboarding-runs'
import { route } from '@/lib/api/route'
import { tenantAccess } from '@/lib/api/route-auth'
import { startOnboardingRun } from '@/lib/tenant/onboarding-runs'

/** Read a product's site into drafts within ten seconds and start the background run. */
export const POST = route(createOnboardingRunContract, {
  auth: tenantAccess({ apiKeyScope: 'onboarding:run', permission: 'workspace:update' }),
  handler: async ({ access, body, headers }) =>
    startOnboardingRun(access, {
      ...body,
      idempotencyKey: headers['idempotency-key'] || undefined,
    }),
  status: (result) => (result.created ? 201 : 200),
})
