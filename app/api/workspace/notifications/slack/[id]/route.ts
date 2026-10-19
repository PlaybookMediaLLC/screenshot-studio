import { disconnectNotificationSlackContract } from '@/lib/api/contracts/notifications'
import { route } from '@/lib/api/route'
import { backendSDK } from '@/lib/backend/sdk'
import { notificationAccess } from '@/lib/notifications/server'

/** `DELETE /api/workspace/notifications/slack/{id}`: act only for the current session and workspace. */
export const DELETE = route(disconnectNotificationSlackContract, {
  auth: notificationAccess('workspace:update'),
  handler: ({ params, access }) => backendSDK(access).disconnectNotificationSlack(params.id),
})
