import { createAssetUploadUrlContract } from '@/lib/api/contracts/assets'
import { route } from '@/lib/api/route'
import { tenantAccess } from '@/lib/api/route-auth'
import { signAssetUpload } from '@/lib/tenant/assets'

/** Record a pending asset and return a signed upload URL for it. */
export const POST = route(createAssetUploadUrlContract, {
  auth: tenantAccess(createAssetUploadUrlContract.access),
  handler: async ({ access, body }) => signAssetUpload(access, body),
})
