import {
  addCredentialContract,
  listCredentialsContract,
} from '@/lib/api/contracts/store-publishing'
import { route } from '@/lib/api/route'
import { paidSessionAccess } from '@/lib/api/route-auth'
import { storeScreenshotsErrorResponse } from '@/lib/api/store-screenshots-errors'
import { isStoreCredentialEncryptionConfigured } from '@/lib/tenant/store-credential-crypto'
import { addPublishingCredential, listPublishingCredentials } from '@/lib/tenant/store-screenshots'

/** Store credentials without their secrets, and whether storage is configured. */
export const GET = route(listCredentialsContract, {
  auth: paidSessionAccess('publish:manage'),
  handler: async ({ access }) => ({
    credentials: await listPublishingCredentials(access),
    configured: isStoreCredentialEncryptionConfigured(),
  }),
})

/** Store a credential. Requires a fresh second factor; the secret is encrypted before it leaves this server. */
export const POST = route(addCredentialContract, {
  auth: paidSessionAccess('publish:manage', { sensitive: true }),
  handler: async ({ access, body }) => {
    try {
      return await addPublishingCredential(access, body)
    } catch (cause) {
      return storeScreenshotsErrorResponse(cause)
    }
  },
})
