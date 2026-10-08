import 'server-only'

import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { isCampaignWorkflowEnabled } from '@/lib/tenant/entitlements'
import { resolveActiveOrganizationId } from './access'
import { auth } from './server'

async function getPageMembership(organizationId: string | null, userId: string) {
  if (!organizationId) return null
  return prisma.member.findUnique({
    select: {
      id: true,
      organization: {
        select: {
          id: true,
          logo: true,
          name: true,
          slug: true,
          workspaceDeletion: {
            select: { requestedByUserId: true, scheduledFor: true, status: true },
          },
          workspaceSettings: true,
        },
      },
      role: true,
    },
    where: { organizationId_userId: { organizationId, userId } },
  })
}

function isPageWorkspaceOperational(membership: Awaited<ReturnType<typeof getPageMembership>>) {
  const status = membership?.organization.workspaceDeletion?.status
  return status !== 'PENDING' && status !== 'PROCESSING' && status !== 'PURGED'
}

export async function getPageAccess(requestHeaders: Headers) {
  const session = await auth.api.getSession({
    headers: requestHeaders,
    query: { disableCookieCache: true },
  })
  if (!session) return null

  const activeOrganizationId = await resolveActiveOrganizationId(session.session, session.user.id)
  const [membership, membershipCount] = await Promise.all([
    getPageMembership(activeOrganizationId, session.user.id),
    prisma.member.count({ where: { userId: session.user.id } }),
  ])
  return {
    campaignWorkflowEnabled: membership
      ? await isCampaignWorkflowEnabled(membership.organization.id)
      : false,
    hasOrganization: membershipCount > 0,
    isWorkspaceOperational: isPageWorkspaceOperational(membership),
    organization: membership?.organization ?? null,
    role: membership?.role ?? 'viewer',
    session,
  }
}

export function getLocalizedPath(locale: string, path: string): string {
  return locale === 'en' ? path : `/${locale}${path}`
}

/**
 * Sign-in and sign-up send someone who is already signed in on to the app,
 * or to the in-app page they were headed for. Only same-origin paths are
 * followed, matching the form's own callbackURL check.
 */
export async function redirectIfSignedIn(
  requestHeaders: Headers,
  locale: string,
  callbackURL: string | string[] | undefined
): Promise<void> {
  const session = await auth.api.getSession({ headers: requestHeaders })
  if (!session) return
  const target =
    typeof callbackURL === 'string' && callbackURL.startsWith('/') && !callbackURL.startsWith('//')
      ? callbackURL
      : '/'
  redirect(getLocalizedPath(locale, target))
}
