import { rotateWebhookSecretContract } from '@/lib/api/contracts/settings-platform'
import { route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { backendSDK } from '@/lib/backend/sdk'

/** Rotate the signing secret; the new one is returned this once. */
export const POST = route(rotateWebhookSecretContract, {
  auth: organizationAccess('workspace:update'),
  handler: ({ access, params }) => backendSDK(access).rotateWebhookSecret(params.id),
})
