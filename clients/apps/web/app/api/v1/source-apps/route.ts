import { createSourceAppContract } from '@/lib/api/contracts/source-apps'
import { route } from '@/lib/api/route'
import { tenantAccess } from '@/lib/api/route-auth'
import { createSourceApp } from '@/lib/tenant/configuration'
import { getSourceWebhookSetup } from '@/lib/tenant/webhooks'

/** Register a source app whose webhooks may create releases, and say where they go. */
export const POST = route(createSourceAppContract, {
  auth: tenantAccess(createSourceAppContract.access),
  handler: async ({ access, body }) => {
    const sourceApp = await createSourceApp(access, body)
    return { sourceApp, webhook: getSourceWebhookSetup(sourceApp) }
  },
})
