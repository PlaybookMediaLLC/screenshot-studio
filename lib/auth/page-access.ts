import 'server-only'

import { prisma } from '@/lib/db'
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
