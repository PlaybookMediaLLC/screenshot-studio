import { createShellJsonRoute } from '@/lib/api/v1/route'
import { requireSessionAccess } from '@/lib/auth/access'
import { prisma } from '@/lib/db'

export const GET = createShellJsonRoute({
  name: 'me',
  execute: async (request) => {
    const access = await requireSessionAccess(request.headers)
    const user = await prisma.user.findUniqueOrThrow({
      select: { email: true, id: true, image: true, name: true },
      where: { id: access.principal.userId },
    })
    return { user }
  },
})
