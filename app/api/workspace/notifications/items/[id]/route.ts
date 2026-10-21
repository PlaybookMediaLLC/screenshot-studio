import { setNotificationSeenContract } from '@/lib/api/contracts/notifications'
import { route } from '@/lib/api/route'
import { backendSDK } from '@/lib/backend/sdk'
import { notificationAccess } from '@/lib/notifications/server'

/** Change only the current recipient's notification. */
export const PATCH = route(setNotificationSeenContract, {
  auth: notificationAccess('workspace:read'),
  handler: ({ params, body, access }) =>
    backendSDK(access).setNotificationSeen(params.id, body.seen),
})
