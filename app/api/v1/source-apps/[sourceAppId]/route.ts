import { updateSourceAppContract } from '@/lib/api/contracts/source-apps'
import { route } from '@/lib/api/route'
import { tenantAccess } from '@/lib/api/route-auth'
import { updateSourceApp } from '@/lib/tenant/configuration'

/** Change which of a source app's webhook deliveries become releases. */
export const PATCH = route(updateSourceAppContract, {
  auth: tenantAccess(updateSourceAppContract.access),
  handler: async ({ access, body, params }) => ({
    sourceApp: await updateSourceApp(access, params.sourceAppId, body),
  }),
})
