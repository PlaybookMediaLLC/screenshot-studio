import { ascBrowseContract } from '@/lib/api/contracts/store-publishing'
import { route } from '@/lib/api/route'
import { paidSessionAccess } from '@/lib/api/route-auth'
import { storeScreenshotsErrorResponse } from '@/lib/api/store-screenshots-errors'
import { browseAppStore } from '@/lib/tenant/store-screenshots'

/** Apps, then versions, then localizations visible to an App Store Connect key. */
export const POST = route(ascBrowseContract, {
  auth: paidSessionAccess('publish:manage'),
  handler: async ({ access, body }) => {
    try {
      return await browseAppStore(access, body.credentialId, body.appId, body.versionId)
    } catch (cause) {
      return storeScreenshotsErrorResponse(cause)
    }
  },
})
