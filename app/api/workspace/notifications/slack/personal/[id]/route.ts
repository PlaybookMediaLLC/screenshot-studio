import { disconnectPersonalSlackContract } from '@/lib/api/contracts/notifications'
import { route } from '@/lib/api/route'
import { backendSDK } from '@/lib/backend/sdk'
import { notificationAccess } from '@/lib/notifications/server'

/** Remove only the current member's personal Slack connection. */
export const DELETE = route(disconnectPersonalSlackContract, {
  auth: notificationAccess(),
  handler: ({ params, access }) => backendSDK(access).disconnectPersonalSlack(params.id),
})
