import { getNotificationDeliveriesContract } from '@/lib/api/contracts/notifications'
import { route } from '@/lib/api/route'
import { backendSDK } from '@/lib/backend/sdk'
import { notificationAccess } from '@/lib/notifications/server'

/** `GET /api/workspace/notifications/deliveries`: act only for the current session and workspace. */
export const GET = route(getNotificationDeliveriesContract, {
  auth: notificationAccess('workspace:update'),
  handler: ({ access }) => backendSDK(access).notificationDeliveries(),
})
