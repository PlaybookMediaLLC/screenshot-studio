import 'server-only'

import { requireOrganizationPermission } from '@/lib/auth/access'

/**
 * True when the request comes from a signed-in member of the workspace that
 * owns a workspace-only link, with that workspace active.
 */
export async function canViewWorkspaceLink(
  headers: Headers,
  organizationId: string
): Promise<boolean> {
  try {
    await requireOrganizationPermission(headers, organizationId, 'artifact:read')
    return true
  } catch {
    return false
  }
}
