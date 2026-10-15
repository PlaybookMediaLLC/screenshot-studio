import 'server-only'

import { serviceBackend } from '@/lib/backend/sdk'

/** Background and transport boundaries share this guard with member access. */
export async function isWorkspaceOperational(organizationId: string): Promise<boolean> {
  return serviceBackend().isWorkspaceOperational(organizationId)
}
