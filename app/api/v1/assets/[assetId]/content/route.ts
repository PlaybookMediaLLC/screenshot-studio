import { assetContentContract } from '@/lib/api/contracts/assets'
import { route } from '@/lib/api/route'
import { tenantAccess } from '@/lib/api/route-auth'
import { backendSDK, serviceBackend } from '@/lib/backend/sdk'

/** Returns private bytes only after Go rechecks the session or download grant. */
export const GET = route(assetContentContract, {
  auth: async (context) =>
    context.request.nextUrl.searchParams.has('downloadToken')
      ? null // The backend validates the encrypted grant before accessing storage.
      : tenantAccess({ apiKeyScope: 'artifact:read', permission: 'artifact:read' })(context),
  handler: async ({ access, params, query, headers }) => {
    const source = access
      ? await backendSDK(access).readAssetResponse(params.assetId, headers.range)
      : await serviceBackend().readAssetDownload(
          params.assetId,
          query.downloadToken ?? '',
          headers.range
        )
    const responseHeaders = new Headers({
      'cache-control': 'private, no-store',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "sandbox; default-src 'none'",
    })
    for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const value = source.headers.get(name)
      if (value) responseHeaders.set(name, value)
    }
    return new Response(source.body, { headers: responseHeaders, status: source.status })
  },
})
