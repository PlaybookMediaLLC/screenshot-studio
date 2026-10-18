import { listOnboardingEnrichmentContract } from '@/lib/api/contracts/onboarding-runs'
import { route } from '@/lib/api/route'
import { tenantAccess } from '@/lib/api/route-auth'
import { listOnboardingEnrichment } from '@/lib/tenant/onboarding-runs'

/** What enrichment found for a run's site. */
export const GET = route(listOnboardingEnrichmentContract, {
  auth: tenantAccess({ apiKeyScope: 'onboarding:run', permission: 'workspace:read' }),
  handler: async ({ access, params }) => ({
    enrichment: await listOnboardingEnrichment(access, params.runId),
  }),
})
