import { listExperimentsContract } from '@/lib/api/contracts/settings-platform'
import { route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { backendSDK } from '@/lib/backend/sdk'

/** The experiment registry, evaluated for you in this workspace. */
export const GET = route(listExperimentsContract, {
  auth: organizationAccess('workspace:read'),
  handler: ({ access }) => backendSDK(access).listExperiments(),
})
