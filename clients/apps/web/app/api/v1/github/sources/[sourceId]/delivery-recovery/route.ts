import {
  getGitHubRecoveryContract,
  inspectGitHubRecoveryContract,
} from '@/lib/api/contracts/github-production'
import { route } from '@/lib/api/route'
import { memberAccess } from '@/lib/api/route-auth'
import { getGitHubRecovery, inspectGitHubRecovery } from '@/lib/tenant/github-production'
/** getGitHubRecovery: authorization and validation use the shared route boundary. */
export const GET = route(getGitHubRecoveryContract, {
  auth: memberAccess(getGitHubRecoveryContract.access),
  handler: async ({ access, params }) => getGitHubRecovery(access, params.sourceId),
})
/** inspectGitHubRecovery: authorization and validation use the shared route boundary. */
export const POST = route(inspectGitHubRecoveryContract, {
  auth: memberAccess(inspectGitHubRecoveryContract.access),
  handler: async ({ access, params, body }) =>
    inspectGitHubRecovery(access, params.sourceId, body.redeliver),
})
