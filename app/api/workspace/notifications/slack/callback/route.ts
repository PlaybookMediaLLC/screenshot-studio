import { completeNotificationSlackContract } from '@/lib/api/contracts/notifications'
import { route } from '@/lib/api/route'
import { backendSDK } from '@/lib/backend/sdk'
import { notificationAccess } from '@/lib/notifications/server'

/** `POST /api/workspace/notifications/slack/callback`: act only for the current session and workspace. */
export const POST = route(completeNotificationSlackContract, {
  auth: notificationAccess('workspace:update'),
  handler: ({ body, access }) => backendSDK(access).completeNotificationSlack(body),
})
