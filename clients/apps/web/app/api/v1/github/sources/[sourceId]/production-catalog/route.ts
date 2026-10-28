import { getGitHubProductionCatalogContract } from '@/lib/api/contracts/github-production'
import { route } from '@/lib/api/route'
import { memberAccess } from '@/lib/api/route-auth'
import { getGitHubProductionCatalog } from '@/lib/tenant/github-production'
/** getGitHubProductionCatalog: authorization and validation use the shared route boundary. */
export const GET = route(getGitHubProductionCatalogContract, {
  auth: memberAccess(getGitHubProductionCatalogContract.access),
  handler: async ({ access, params, query }) =>
    getGitHubProductionCatalog(access, params.sourceId, query?.runId, query?.attempt),
})
