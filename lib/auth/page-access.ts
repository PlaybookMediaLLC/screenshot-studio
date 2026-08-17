import 'server-only'

import { prisma } from '@/lib/db'
import { resolveActiveOrganizationId } from './access'
import { auth } from './server'

export async function getPageAccess(requestHeaders: Headers) {
  const session = await auth.api.getSession({
    headers: requestHeaders,
    query: { disableCookieCache: true },
  })
  if (!session) return null

  const activeOrganizationId = await resolveActiveOrganizationId(session.session, session.user.id)
  const [membership, membershipCount] = await Promise.all([
    activeOrganizationId
      ? prisma.member.findUnique({
          select: {
            id: true,
            organization: { select: { id: true, name: true, slug: true } },
            role: true,
          },
          where: {
            organizationId_userId: {
              organizationId: activeOrganizationId,
              userId: session.user.id,
            },
          },
        })
      : null,
    prisma.member.count({ where: { userId: session.user.id } }),
  ])
  return {
    hasOrganization: membershipCount > 0,
    organization: membership?.organization ?? null,
    role: membership?.role ?? 'viewer',
    session,
  }
}

export function getLocalizedPath(locale: string, path: string): string {
  return locale === 'en' ? path : `/${locale}${path}`
}
