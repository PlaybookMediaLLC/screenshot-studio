import { NextResponse } from 'next/server'
import { assetContentContract } from '@/lib/api/contracts/assets'
import { errorResponse, route } from '@/lib/api/route'
import { tenantAccess } from '@/lib/api/route-auth'
import { signAssetDownload } from '@/lib/tenant/assets'

/** Redirects to a short-lived signed URL, so documents can embed a stable one. */
export const GET = route(assetContentContract, {
  auth: tenantAccess({ apiKeyScope: 'artifact:read', permission: 'artifact:read' }),
  handler: async ({ access, params }) => {
    const downloadUrl = await signAssetDownload(access, params.assetId)
    if (!downloadUrl) return errorResponse(404, 'Asset not found.')
    const response = NextResponse.redirect(downloadUrl, 302)
    // The signed URL expires; never let a cache keep the redirect.
    response.headers.set('cache-control', 'private, no-store')
    return response
  },
})
