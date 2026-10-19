import { getNotificationSlackChannelsContract } from '@/lib/api/contracts/notifications'
import { route } from '@/lib/api/route'
import { backendSDK } from '@/lib/backend/sdk'
import { notificationAccess } from '@/lib/notifications/server'

/** `GET /api/workspace/notifications/slack/channels`: act only for the current session and workspace. */
export const GET = route(getNotificationSlackChannelsContract, {
  auth: notificationAccess('workspace:update'),
  handler: ({ query, access }) =>
    backendSDK(access).notificationSlackChannels(query.connectionId, query.cursor),
})
