import 'server-only'

import type { OrganizationAccess } from '@/lib/auth/access'
import { prisma } from '@/lib/db'
import { getWorkspaceEntitlementSummary } from '@/lib/tenant/entitlements'
import { listWorkspaces } from '@/lib/workspace/service'
import {
  buildPlaybookBootstrap,
  type PlaybookBootstrap,
  type PlaybookCapabilities,
} from './bootstrap-shape'

/**
 * Capabilities the active organization can use today. Browser automation,
 * voice capture, the engineering agent, and workflows have no execution
 * engine connected yet, so they report false until one is.
 */
export async function getOrganizationCapabilities(
  organizationId: string
): Promise<PlaybookCapabilities> {
  const activeChannels = await prisma.channelConnection.count({
    where: { organizationId, status: 'ACTIVE' },
  })
  return {
    browserAutomation: false,
    engineeringAgent: false,
    publishing: activeChannels > 0,
    voiceCapture: false,
    workflows: false,
  }
}

async function getCounters(organizationId: string) {
  const [approvals, attention] = await Promise.all([
    prisma.campaignPost.count({ where: { organizationId, status: 'READY_FOR_REVIEW' } }),
    prisma.scheduledPost.count({ where: { organizationId, status: 'FAILED' } }),
  ])
  return { approvals, attention }
}

/** Resolve the bootstrap for an already-authorized active organization. */
export async function getPlaybookBootstrap(access: OrganizationAccess): Promise<PlaybookBootstrap> {
  const { organizationId } = access
  const [user, organization, organizations, entitlements, capabilities, counters] =
    await Promise.all([
      prisma.user.findUniqueOrThrow({
        select: { email: true, id: true, name: true },
        where: { id: access.principal.userId },
      }),
      prisma.organization.findUniqueOrThrow({
        select: { id: true, logo: true, name: true, slug: true, workspaceSettings: true },
        where: { id: organizationId },
      }),
      listWorkspaces(access),
      getWorkspaceEntitlementSummary(organizationId),
      getOrganizationCapabilities(organizationId),
      getCounters(organizationId),
    ])
  return buildPlaybookBootstrap({
    capabilities,
    counters,
    entitlements,
    organization,
    organizations,
    role: access.role,
    settings: organization.workspaceSettings,
    user,
  })
}
