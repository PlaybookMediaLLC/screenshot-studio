import 'server-only'

import { AuthorizationError } from './access'
import { apiKeyScopePermissions, type ApiKeyScope } from './api-key-scopes'
import { auth } from './server'

export async function requireOrganizationApiKeyScope(
  headers: Headers,
  organizationId: string,
  scope: ApiKeyScope
): Promise<{ keyId: string }> {
  const key = headers.get('x-api-key')
  if (!key) {
    throw new AuthorizationError('An organization API key is required.', 401)
  }

  const result = await auth.api.verifyApiKey({
    body: { key, permissions: apiKeyScopePermissions[scope] },
  })
  if (!result.valid || !result.key || result.key.referenceId !== organizationId) {
    throw new AuthorizationError('The organization API key is not authorized for this action.', 403)
  }

  return { keyId: result.key.id }
}
