import 'server-only'

import { prisma } from '@/lib/db'
import { auth } from './server'

export async function getPageAccess(requestHeaders: Headers) {
  const session = await auth.api.getSession({ headers: requestHeaders })
  if (!session) return null

  const membership = await prisma.member.findFirst({
    select: {
      id: true,
      organization: { select: { id: true, name: true } },
    },
    where: { userId: session.user.id },
  })
  return {
    hasOrganization: Boolean(membership),
    organization: membership?.organization ?? null,
    session,
  }
}

export function getLocalizedPath(locale: string, path: string): string {
  return locale === 'en' ? path : `/${locale}${path}`
}
