import { AppStoreConnectError } from '@/lib/integrations/app-store-connect'
import { GooglePlayError } from '@/lib/integrations/google-play'
import { errorResponse } from '@/lib/api/route'
import { StoreCredentialKeyError } from '@/lib/tenant/store-credential-crypto'
import { StoreScreenshotsError } from '@/lib/tenant/store-screenshots'

const PROVIDER_STATUS = {
  unauthorized: 400,
  forbidden: 403,
  'not-found': 404,
  conflict: 409,
  'rate-limited': 429,
  invalid: 400,
  unavailable: 503,
} as const

/**
 * Turn a known store screenshot failure into the documented error response,
 * or rethrow it for the route pipeline. Provider messages describe the
 * request, never the credential.
 */
export function storeScreenshotsErrorResponse(cause: unknown): Response {
  if (cause instanceof StoreScreenshotsError) return errorResponse(cause.status, cause.message)
  if (cause instanceof StoreCredentialKeyError)
    return errorResponse(503, 'Store publishing is not configured on this server.')
  if (cause instanceof AppStoreConnectError) {
    const prefix = cause.code === 'unauthorized' ? 'App Store Connect rejected the API key. ' : ''
    return errorResponse(PROVIDER_STATUS[cause.code], `${prefix}${cause.message}`)
  }
  if (cause instanceof GooglePlayError) {
    const prefix = cause.code === 'unauthorized' ? 'Google Play rejected the service account. ' : ''
    return errorResponse(PROVIDER_STATUS[cause.code], `${prefix}${cause.message}`)
  }
  throw cause
}

/** Decode base64 image data; null when it is not valid base64. */
export function decodeBase64Image(value: string): Uint8Array | null {
  const cleaned = value.replace(/^data:[^,]+,/, '')
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned)) return null
  return new Uint8Array(Buffer.from(cleaned, 'base64'))
}
