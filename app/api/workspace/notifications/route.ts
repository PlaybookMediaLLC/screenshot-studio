import { getNotificationSettingsContract } from '@/lib/api/contracts/notifications'
import { route } from '@/lib/api/route'
import { backendSDK } from '@/lib/backend/sdk'
import { notificationAccess } from '@/lib/notifications/server'

/** `GET /api/workspace/notifications`: act only for the current session and workspace. */
export const GET = route(getNotificationSettingsContract, {
  auth: notificationAccess('workspace:read'),
  handler: ({ access }) => backendSDK(access).notificationSettings(),
})
