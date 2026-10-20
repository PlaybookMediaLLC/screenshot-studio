import { createWebhookContract, listWebhooksContract } from '@/lib/api/contracts/settings-platform'
import { route } from '@/lib/api/route'
import { organizationAccess } from '@/lib/api/route-auth'
import { backendSDK } from '@/lib/backend/sdk'

/** The workspace's outbound webhooks; secrets are never listed. */
export const GET = route(listWebhooksContract, {
  auth: organizationAccess('workspace:update'),
  handler: ({ access }) => backendSDK(access).listWebhooks(),
})

/** Add an outbound webhook; its secret is returned this once. */
export const POST = route(createWebhookContract, {
  auth: organizationAccess('workspace:update'),
  handler: ({ access, body }) => backendSDK(access).createWebhook(body),
})
