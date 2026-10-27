import { getNotificationDeliveryContract } from '@/lib/api/contracts/notifications'
import { route } from '@/lib/api/route'
import { backendSDK } from '@/lib/backend/sdk'
import { notificationAccess } from '@/lib/notifications/server'
/** Return authorized, content-free delivery status. */
export const GET = route(getNotificationDeliveryContract, {
  auth: notificationAccess(),
  handler: ({ access, params }) => backendSDK(access).notificationDelivery(params.id),
})
