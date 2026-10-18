import 'server-only'

import {
  requireActiveOrganizationPermission,
  requireSensitiveActiveOrganizationPermission,
  type TenantContext,
} from '@/lib/auth/access'
import { requireOrganizationApiKeyScope } from '@/lib/auth/api-keys'
import type { TenantAccessRequirement } from '@/lib/api/access-requirements'
import { consumeWorkspaceQuota, requireWorkspaceFeature } from '@/lib/tenant/entitlements'

export async function requireTenantAccess(
  headers: Headers,
  requirement: TenantAccessRequirement
): Promise<TenantContext> {
  const context = headers.has('x-api-key')
    ? await requireOrganizationApiKeyScope(headers, requirement.apiKeyScope)
    : requirement.sensitive
      ? await requireSensitiveActiveOrganizationPermission(headers, requirement.permission)
      : await requireActiveOrganizationPermission(headers, requirement.permission)

  // There is no free plan: every tenant operation needs an active subscription.
  await requireWorkspaceFeature(context, 'workspace:use')
  if (requirement.feature) {
    await requireWorkspaceFeature(context, requirement.feature)
  }
  if (requirement.quota) {
    await consumeWorkspaceQuota(context, requirement.quota)
  }

  return context
}
