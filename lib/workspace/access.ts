import 'server-only'

import { WorkspaceDeletionStatus } from '@prisma/client'
import { prisma } from '@/lib/db'

/** Background and transport boundaries share this guard with member access. */
export async function isWorkspaceOperational(organizationId: string): Promise<boolean> {
  const deletion = await prisma.workspaceDeletion.findUnique({
    select: { status: true },
    where: { organizationId },
  })
  return !deletion || deletion.status === WorkspaceDeletionStatus.CANCELLED
}
