import { setWorkspaceExperimentContract } from '@/lib/api/contracts/settings-platform'
import { route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { backendSDK } from '@/lib/backend/sdk'

/** Turn an experiment off, or back on, for everyone in the workspace. */
export const PUT = route(setWorkspaceExperimentContract, {
  auth: organizationAccess('workspace:update'),
  handler: ({ access, body, params }) =>
    backendSDK(access).setWorkspaceExperiment(params.id, body.disabled),
})
