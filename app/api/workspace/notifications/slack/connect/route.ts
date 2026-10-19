import { connectNotificationSlackContract } from '@/lib/api/contracts/notifications'
import { route } from '@/lib/api/route'
import { backendSDK } from '@/lib/backend/sdk'
import { notificationAccess } from '@/lib/notifications/server'

/** `POST /api/workspace/notifications/slack/connect`: act only for the current session and workspace. */
export const POST = route(connectNotificationSlackContract, {
  auth: notificationAccess('workspace:update'),
  handler: ({ body, access }) =>
    backendSDK(access).connectNotificationSlack(body.purpose, body.connectionId),
})
