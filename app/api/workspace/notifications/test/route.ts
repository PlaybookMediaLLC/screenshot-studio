import { testNotificationContract } from '@/lib/api/contracts/notifications'
import { route } from '@/lib/api/route'
import { backendSDK } from '@/lib/backend/sdk'
import { notificationAccess } from '@/lib/notifications/server'

/** `POST /api/workspace/notifications/test`: act only for the current session and workspace. */
export const POST = route(testNotificationContract, {
  auth: notificationAccess('workspace:read'),
  handler: ({ body, access }) => backendSDK(access).testNotification(body),
})
