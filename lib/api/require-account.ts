import 'server-only'

import type { NextResponse } from 'next/server'
import { editorUtilityAccess } from '@/lib/api/access-requirements'
import { apiError } from '@/lib/api/errors'
import { AuthorizationError } from '@/lib/auth/access'
import { requireTenantAccess } from '@/lib/tenant/access'
import { WorkspaceEntitlementError } from '@/lib/tenant/entitlements'
import { isCrossOriginCookieMutation } from '@/lib/security/request-origin'

/**
 * Refuses a request without a paying workspace behind it. Editor utilities
 * accept a signed-in session (the editor and tools in the browser) or a
 * workspace API key with the `artifact:read` scope (scripts), and the
 * workspace needs an active paid plan; there is no free plan. Returns the
 * error response to send, or null to continue.
 */
export async function requirePaidAccess(request: Request): Promise<NextResponse | null> {
  if (isCrossOriginCookieMutation(request)) {
    return apiError(
      403,
      'forbidden',
      'Cross-origin cookie-authenticated writes are not allowed.',
      'Submit this request from the application or use an authenticated API client.'
    )
  }
  try {
    await requireTenantAccess(request.headers, editorUtilityAccess)
    return null
  } catch (error) {
    if (error instanceof WorkspaceEntitlementError) {
      return apiError(
        403,
        'workspace_feature_not_entitled',
        'This workspace has no active plan.',
        'Choose a plan at https://shots.playbookmedia.io/pricing, then retry.'
      )
    }
    if (error instanceof AuthorizationError) {
      return apiError(
        error.status,
        error.status === 401 ? 'unauthorized' : 'forbidden',
        error.message,
        'Sign in at https://shots.playbookmedia.io/sign-in, or send a workspace API key with the artifact:read scope in the X-API-Key header.'
      )
    }
    throw error
  }
}
