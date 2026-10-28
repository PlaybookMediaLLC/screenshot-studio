import {
  getGitHubProductionContract,
  saveGitHubProductionContract,
} from '@/lib/api/contracts/github-production'
import { route } from '@/lib/api/route'
import { memberAccess } from '@/lib/api/route-auth'
import { getGitHubProduction, saveGitHubProduction } from '@/lib/tenant/github-production'
/** getGitHubProduction: authorization and validation use the shared route boundary. */
export const GET = route(getGitHubProductionContract, {
  auth: memberAccess(getGitHubProductionContract.access),
  handler: async ({ access, params, query }) =>
    getGitHubProduction(access, params.sourceId, query?.cursor),
})
/** saveGitHubProduction: authorization and validation use the shared route boundary. */
export const PUT = route(saveGitHubProductionContract, {
  auth: memberAccess(saveGitHubProductionContract.access),
  handler: async ({ access, params, body }) => saveGitHubProduction(access, params.sourceId, body),
})
