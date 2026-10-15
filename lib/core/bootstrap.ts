import 'server-only'

import type { OrganizationAccess } from '@/lib/auth/access'
import { backendSDK } from '@/lib/backend/sdk'
import { buildPlaybookBootstrap, type PlaybookBootstrap } from './bootstrap-shape'

/** Resolve the bootstrap for an already-authorized active organization. */
export async function getPlaybookBootstrap(access: OrganizationAccess): Promise<PlaybookBootstrap> {
  return buildPlaybookBootstrap(await backendSDK(access).getBootstrap())
}
