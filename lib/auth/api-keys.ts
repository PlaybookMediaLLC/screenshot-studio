import 'server-only'

import { AuthorizationError, getRequestId, type TenantContext } from './access'
import { apiKeyScopePermissions, type ApiKeyScope } from './api-key-scopes'
import type { OrganizationApiKeyPrincipal } from './principal'
import { auth } from './server'

export async function requireOrganizationApiKeyScope(
  headers: Headers,
  scope: ApiKeyScope
): Promise<TenantContext & { principal: OrganizationApiKeyPrincipal }> {
  const key = headers.get('x-api-key')
  if (!key) {
    throw new AuthorizationError('An organization API key is required.', 401)
  }

  const result = await auth.api.verifyApiKey({
    body: { key, permissions: apiKeyScopePermissions[scope] },
  })
  if (!result.valid || !result.key || !result.key.referenceId) {
    throw new AuthorizationError('The organization API key is not authorized for this action.', 403)
  }

  return {
    organizationId: result.key.referenceId,
    principal: {
      display: result.key.name ?? result.key.start ?? 'Organization API key',
      keyId: result.key.id,
      kind: 'organization_api_key',
      organizationId: result.key.referenceId,
    },
    requestId: getRequestId(headers),
  }
}
