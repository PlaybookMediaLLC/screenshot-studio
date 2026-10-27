import { saveNotificationPolicyContract } from '@/lib/api/contracts/notifications'
import { route } from '@/lib/api/route'
import { backendSDK } from '@/lib/backend/sdk'
import { notificationAccess } from '@/lib/notifications/server'

/** `PUT /api/workspace/notifications/policy`: act only for the current session and workspace. */
export const PUT = route(saveNotificationPolicyContract, {
  auth: notificationAccess('workspace:update'),
  handler: ({ body, access }) => backendSDK(access).saveNotificationPolicy(body),
})
