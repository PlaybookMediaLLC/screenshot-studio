import { assetDeletionResultSchema, deleteAssetContract } from '@/lib/api/contracts/assets'
import { errorResponse, route } from '@/lib/api/route'
import { tenantAccess } from '@/lib/api/route-auth'
import { deleteAsset } from '@/lib/tenant/assets'

/** Delete an uploaded asset that no creative variant uses. */
export const DELETE = route(deleteAssetContract, {
  // The `asset:delete` gate runs here before any lookup, so every identifier
  // gets the same 403 on a plan without it, and again inside `deleteAsset`
  // so other transports cannot skip it.
  auth: tenantAccess(deleteAssetContract.access),
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
