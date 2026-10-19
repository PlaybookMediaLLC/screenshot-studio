import { getNotificationCountContract } from '@/lib/api/contracts/notifications'
import { route } from '@/lib/api/route'
import { backendSDK } from '@/lib/backend/sdk'
import { notificationAccess } from '@/lib/notifications/server'

/** `GET /api/workspace/notifications/count`: act only for the current session and workspace. */
export const GET = route(getNotificationCountContract, {
  auth: notificationAccess('workspace:read'),
  handler: ({ access }) => backendSDK(access).notificationCount(),
})
