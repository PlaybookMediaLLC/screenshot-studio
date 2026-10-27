import { resolveNotificationContract } from '@/lib/api/contracts/notifications'
import { route } from '@/lib/api/route'
import { backendSDK } from '@/lib/backend/sdk'
import { notificationAccess } from '@/lib/notifications/server'

/** `GET /api/workspace/notifications/resolve/{id}`: act only for the current session and workspace. */
export const GET = route(resolveNotificationContract, {
  auth: notificationAccess('workspace:read'),
  handler: ({ params, access }) => backendSDK(access).resolveNotification(params.id),
})
