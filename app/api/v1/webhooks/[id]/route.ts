import { deleteWebhookContract, updateWebhookContract } from '@/lib/api/contracts/outbound-webhooks'
import { route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { backendSDK } from '@/lib/backend/sdk'

/** Change an outbound webhook. */
export const PATCH = route(updateWebhookContract, {
  auth: organizationAccess('workspace:update'),
  handler: ({ access, body, params }) => backendSDK(access).updateWebhook(params.id, body),
})

/** Delete an outbound webhook and its delivery history. */
export const DELETE = route(deleteWebhookContract, {
  auth: organizationAccess('workspace:update'),
  handler: ({ access, params }) => backendSDK(access).deleteWebhook(params.id),
})
