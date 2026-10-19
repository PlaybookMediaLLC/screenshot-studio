import { recoverNotificationDeliveryContract } from '@/lib/api/contracts/notifications'
import { route } from '@/lib/api/route'
import { backendSDK } from '@/lib/backend/sdk'
import { notificationAccess } from '@/lib/notifications/server'

/** `POST /api/workspace/notifications/deliveries/{id}/recover`: act only for the current session and workspace. */
export const POST = route(recoverNotificationDeliveryContract, {
  auth: notificationAccess('workspace:update'),
  handler: ({ body, params, access }) =>
    backendSDK(access).recoverNotification(params.id, body.action),
})
