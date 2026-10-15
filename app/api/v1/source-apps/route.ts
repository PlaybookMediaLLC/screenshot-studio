import { createSourceAppContract } from '@/lib/api/contracts/source-apps'
import { route } from '@/lib/api/route'
import { tenantAccess } from '@/lib/api/route-auth'
import { createSourceApp } from '@/lib/tenant/configuration'

/** Register a source app whose webhooks may create releases. */
export const POST = route(createSourceAppContract, {
  auth: tenantAccess({ apiKeyScope: 'source:write', permission: 'brand:manage' }),
  handler: async ({ access, body }) => ({ sourceApp: await createSourceApp(access, body) }),
})
