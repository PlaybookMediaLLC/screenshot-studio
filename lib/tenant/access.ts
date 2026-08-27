import 'server-only'

import { requireActiveOrganizationPermission, type TenantContext } from '@/lib/auth/access'
import { requireOrganizationApiKeyScope } from '@/lib/auth/api-keys'
import type { ApiKeyScope } from '@/lib/auth/api-key-scopes'
import type { Permission } from '@/lib/auth/permissions'
import { consumeWorkspaceQuota, requireWorkspaceFeature } from '@/lib/tenant/entitlements'
import type { WorkspaceFeature, WorkspaceQuota } from '@/lib/billing/plans'

type TenantAccessRequirement = {
  apiKeyScope: ApiKeyScope
  feature?: WorkspaceFeature
  permission: Permission
  quota?: WorkspaceQuota
}

export async function requireTenantAccess(
  headers: Headers,
  requirement: TenantAccessRequirement
): Promise<TenantContext> {
  const context = headers.has('x-api-key')
    ? await requireOrganizationApiKeyScope(headers, requirement.apiKeyScope)
    : await requireActiveOrganizationPermission(headers, requirement.permission)

  if (requirement.feature) {
    await requireWorkspaceFeature(context.organizationId, requirement.feature)
  }
  if (requirement.quota) {
    await consumeWorkspaceQuota(context.organizationId, requirement.quota)
  }

  return context
}
