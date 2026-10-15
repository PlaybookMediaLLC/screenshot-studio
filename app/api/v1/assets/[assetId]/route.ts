import { assetDeletionResultSchema, deleteAssetContract } from '@/lib/api/contracts/assets'
import { errorResponse, route } from '@/lib/api/route'
import { tenantAccess } from '@/lib/api/route-auth'
import { deleteAsset } from '@/lib/tenant/assets'

/** Delete an uploaded asset that no creative variant uses. */
export const DELETE = route(deleteAssetContract, {
  // No `feature` here on purpose. The `asset:delete` plan gate runs inside
  // `deleteAsset`, after ownership is resolved, so a caller cannot learn that
  // a foreign asset exists by comparing a 403 against a 404.
  auth: tenantAccess({
    apiKeyScope: 'asset:write',
    permission: 'artifact:edit',
    quota: 'api:write:minute',
  }),
  handler: async ({ access, params }) => {
    const result = await deleteAsset(access, params.assetId)
    const outcome = assetDeletionResultSchema.enum
    if (result === outcome['not-found']) return errorResponse(404, 'Asset not found.')
    if (result === outcome['in-use']) {
      return errorResponse(409, 'Asset is in use by a creative variant.')
    }
    if (result === outcome['not-ready']) {
      return errorResponse(409, 'Only uploaded assets can be deleted.')
    }
    return { accepted: true as const }
  },
})
