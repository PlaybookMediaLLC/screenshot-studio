import 'server-only'

import { cookies, headers } from 'next/headers'
import { notFound } from 'next/navigation'
import type { SocialSet, UserPreferences } from 'screenshot-studio-backend-sdk'
import { getRequestId, type OrganizationAccess } from '@/lib/auth/access'
import { requirePaidPageAccess } from '@/lib/auth/page-access'
import { normalizeOrganizationRole } from '@/lib/auth/permissions'
import type { DraftListItem, QueueItem, RailSocialSet } from '@/components/drafts/DraftsRail'
import { backendSDK } from '@/lib/backend/sdk'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'
import { draftPlainText } from '@/lib/content-drafts/serialize'
import { SOCIAL_SET_COOKIE } from '@/lib/settings/appearance'
import { type listContentDrafts, listContentDraftPostsBetween } from '@/lib/tenant/content-drafts'

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
    publishedPosts: draft.publishedPosts,
    status: draft.status,
    title: draft.title,
    updatedAt: draft.updatedAt.toISOString(),
  }))
}

/**
 * The social sets the person sees, and the one the drafts pages show: the one
 * the address names, else the one they last chose, else the first. The choice
 * is navigation, not access: every read below is checked by the backend.
 */
export async function selectSocialSet(
  tenant: OrganizationAccess,
  requested?: string
): Promise<{ selected: SocialSet | null; sets: SocialSet[] }> {
  const { items } = await backendSDK(tenant).listSocialSets()
  const remembered = (await cookies()).get(SOCIAL_SET_COOKIE)?.value
  const selected =
    items.find((set) => set.id === requested) ?? items.find((set) => set.id === remembered) ?? items[0] ?? null
  return { selected, sets: items }
}

/** The sets as the rail's switcher lists them. */
export function railSets(sets: SocialSet[]): RailSocialSet[] {
  return sets.map((set) => ({ color: set.color, id: set.id, name: set.name, needsAttention: set.needsAttention }))
}

/** The person's preferences, or the defaults if they cannot be read. */
export async function readPreferences(tenant: OrganizationAccess): Promise<UserPreferences | null> {
  return backendSDK(tenant)
    .getUserPreferences()
    .catch(() => null)
}

/** The queue: posts due in the next 60 days that have not gone out, soonest first. */
export async function draftQueue(tenant: OrganizationAccess, socialSetId = ''): Promise<QueueItem[]> {
  const now = new Date()
  const posts = await listContentDraftPostsBetween(
    tenant,
    now,
    new Date(now.getTime() + 60 * 86_400_000),
    socialSetId
  )
  return posts
    .filter((post) => post.status === 'SCHEDULED' || post.status === 'PROCESSING')
    .map((post) => ({
      caption: post.caption,
      draftId: post.draftId,
      id: post.id,
      platform: post.platform,
      scheduledFor: post.scheduledFor.toISOString(),
    }))
}
