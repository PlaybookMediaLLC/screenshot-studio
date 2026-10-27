import 'server-only'

import { headers } from 'next/headers'
import type { BackendPublicShareLink } from 'screenshot-studio-backend-sdk'
import { canViewWorkspaceLink } from './access'
import { shareTokenSchema } from './schema'
import { resolveShareLink } from './server'

/** The app's public origin, for absolute share and media URLs. */
export function appOrigin(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
}

/** What a share page shows: the link, or why it cannot. */
export type ShareView =
  { kind: 'gone' } | { kind: 'members-only' } | { kind: 'visible'; link: BackendPublicShareLink }

/** Read a link for its page, checking workspace-only access against the viewer. */
export async function shareView(token: string): Promise<ShareView> {
  if (!shareTokenSchema.safeParse(token).success) return { kind: 'gone' }
  const link = await resolveShareLink(token)
  if (!link) return { kind: 'gone' }
  if (
    link.access === 'WORKSPACE' &&
    !(await canViewWorkspaceLink(await headers(), link.organizationId))
  ) {
    return { kind: 'members-only' }
  }
  return { kind: 'visible', link }
}
