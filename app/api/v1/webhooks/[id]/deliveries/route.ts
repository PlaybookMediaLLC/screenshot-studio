import { listWebhookDeliveriesContract } from '@/lib/api/contracts/settings-platform'
import { route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { backendSDK } from '@/lib/backend/sdk'

/** Recent deliveries with their attempts. */
export const GET = route(listWebhookDeliveriesContract, {
  auth: organizationAccess('workspace:update'),
  handler: ({ access, params }) => backendSDK(access).listWebhookDeliveries(params.id),
})
