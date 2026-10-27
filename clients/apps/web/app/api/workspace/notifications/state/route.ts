import { changeNotificationStateContract } from '@/lib/api/contracts/notifications'
import { route } from '@/lib/api/route'
import { backendSDK } from '@/lib/backend/sdk'
import { notificationAccess } from '@/lib/notifications/server'

/** Update only the current member's notification receipts in their active workspace. */
export const POST = route(changeNotificationStateContract, {
  auth: notificationAccess('workspace:read'),
  handler: ({ body, access }) => backendSDK(access).changeNotificationState(body),
})
