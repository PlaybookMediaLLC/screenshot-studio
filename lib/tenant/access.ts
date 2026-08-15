import 'server-only'

import { requireActiveOrganizationPermission, type TenantContext } from '@/lib/auth/access'
import { requireOrganizationApiKeyScope } from '@/lib/auth/api-keys'
import type { ApiKeyScope } from '@/lib/auth/api-key-scopes'
import type { Permission } from '@/lib/auth/permissions'

type TenantAccessRequirement = {
  apiKeyScope: ApiKeyScope
  permission: Permission
}

export async function requireTenantAccess(
  headers: Headers,
  requirement: TenantAccessRequirement
): Promise<TenantContext> {
  if (headers.has('x-api-key')) {
    return requireOrganizationApiKeyScope(headers, requirement.apiKeyScope)
  }

  return requireActiveOrganizationPermission(headers, requirement.permission)
}
