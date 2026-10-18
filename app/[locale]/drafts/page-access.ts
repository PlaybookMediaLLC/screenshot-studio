import 'server-only'

import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { getRequestId, type OrganizationAccess } from '@/lib/auth/access'
import { requirePaidPageAccess } from '@/lib/auth/page-access'
import { normalizeOrganizationRole } from '@/lib/auth/permissions'
import type { DraftListItem } from '@/components/drafts/DraftsRail'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'
import { draftPlainText } from '@/lib/content-drafts/serialize'
import type { listContentDrafts } from '@/lib/tenant/content-drafts'

/**
 * Shared guard for the drafts pages: a paid workspace member, inside the
 * content drafts rollout (RFC 037). Outside the rollout the pages do not exist.
 */
export async function requireDraftsPageAccess(locale: string, returnTo: string) {
  const requestHeaders = await headers()
  const access = await requirePaidPageAccess(requestHeaders, locale, returnTo)
  if (!contentDraftsEnabled() || !access.organization) notFound()
  // Reads run as the signed-in session, scoped to the active workspace.
  const tenant: OrganizationAccess = {
    organizationId: access.organization.id,
    principal: {
      display: access.session.user.email,
      kind: 'session',
      sessionId: access.session.session.id,
      userId: access.session.user.id,
    },
    requestId: getRequestId(requestHeaders),
    role: normalizeOrganizationRole(access.role),
  }
  return { ...access, organization: access.organization, tenant }
}

/** Drafts as the list on the left of the drafts pages shows them. */
export function draftListItems(
  drafts: Awaited<ReturnType<typeof listContentDrafts>>['items']
): DraftListItem[] {
  return drafts.map((draft) => ({
    excerpt: (draft.plainText || draftPlainText(draft.body)).slice(0, 160),
    id: draft.id,
    status: draft.status,
    title: draft.title,
    updatedAt: draft.updatedAt.toISOString(),
  }))
}
