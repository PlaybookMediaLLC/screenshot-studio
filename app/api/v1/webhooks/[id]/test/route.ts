import { testWebhookContract } from '@/lib/api/contracts/outbound-webhooks'
import { route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { backendSDK } from '@/lib/backend/sdk'

/** Queue a signed test delivery. */
export const POST = route(testWebhookContract, {
  auth: organizationAccess('workspace:update'),
  handler: ({ access, params }) => backendSDK(access).testWebhook(params.id),
})
