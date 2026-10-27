import { deleteCredentialContract } from '@/lib/api/contracts/store-publishing'
import { route } from '@/lib/api/route'
import { paidSessionAccess } from '@/lib/api/route-auth'
import { deletePublishingCredential } from '@/lib/tenant/store-screenshots'

/** Delete a store credential. */
export const DELETE = route(deleteCredentialContract, {
  auth: paidSessionAccess('publish:manage', { sensitive: true }),
  handler: async ({ access, params }) => {
    await deletePublishingCredential(access, params.credentialId)
    return { deleted: true }
  },
})
