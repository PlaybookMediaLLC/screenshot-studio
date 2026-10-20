import { retryWebhookDeliveryContract } from '@/lib/api/contracts/settings-platform'
import { route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { backendSDK } from '@/lib/backend/sdk'

/** Replay a delivery that stopped retrying. */
export const POST = route(retryWebhookDeliveryContract, {
  auth: organizationAccess('workspace:update'),
  handler: ({ access, params }) => backendSDK(access).retryWebhookDelivery(params.id),
})
