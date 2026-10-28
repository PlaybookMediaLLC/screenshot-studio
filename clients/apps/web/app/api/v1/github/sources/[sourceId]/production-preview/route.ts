import { previewGitHubProductionContract } from '@/lib/api/contracts/github-production'
import { route } from '@/lib/api/route'
import { memberAccess } from '@/lib/api/route-auth'
import { previewGitHubProduction } from '@/lib/tenant/github-production'
/** previewGitHubProduction: authorization and validation use the shared route boundary. */
export const POST = route(previewGitHubProductionContract, {
  auth: memberAccess(previewGitHubProductionContract.access),
  handler: async ({ access, params, body }) =>
    previewGitHubProduction(access, params.sourceId, body),
})
