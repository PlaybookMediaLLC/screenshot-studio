import { getNotificationInboxContract } from '@/lib/api/contracts/notifications'
import { route } from '@/lib/api/route'
import { backendSDK } from '@/lib/backend/sdk'
import { notificationAccess } from '@/lib/notifications/server'

/** `GET /api/workspace/notifications/inbox`: act only for the current session and workspace. */
export const GET = route(getNotificationInboxContract, {
  auth: notificationAccess('workspace:read'),
  handler: ({ query, access }) => backendSDK(access).notificationInbox(query.cursor),
})
