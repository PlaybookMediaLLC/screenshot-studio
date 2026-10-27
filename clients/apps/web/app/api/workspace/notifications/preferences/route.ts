import { saveNotificationPreferencesContract } from '@/lib/api/contracts/notifications'
import { route } from '@/lib/api/route'
import { backendSDK } from '@/lib/backend/sdk'
import { notificationAccess } from '@/lib/notifications/server'

/** `PUT /api/workspace/notifications/preferences`: act only for the current session and workspace. */
export const PUT = route(saveNotificationPreferencesContract, {
  auth: notificationAccess('workspace:read'),
  handler: ({ body, access }) => backendSDK(access).saveNotificationPreferences(body),
})
