import { getRolePermissions, normalizeOrganizationRole } from '@/lib/auth/permissions'

/**
 * The shell bootstrap contract served by GET /api/v1/bootstrap.
 *
 * Every Playbook shell (web, Wanta, OpenWhispr, CLI) calls this after sign-in
 * instead of reading tRPC internals. It is a rendering hint, never an
 * authority: every mutation re-checks membership and permission server-side,
 * and a 401/403 tells the shell to fetch the bootstrap again.
 */
export type PlaybookBootstrap = {
  user: { id: string; name: string | null; email: string }
  organization: { id: string; name: string; slug: string; logo: string | null }
  organizations: Array<{ id: string; name: string; slug: string; role: string }>
  membership: { role: string; permissions: string[] }
  workspace: { locale: string; timeZone: string; defaultPublishTime: string }
  entitlements: { plan: string; status: string; features: Record<string, boolean> }
  capabilities: PlaybookCapabilities
  counters: { attention: number; approvals: number }
}

export type PlaybookCapabilities = {
  browserAutomation: boolean
  voiceCapture: boolean
  engineeringAgent: boolean
  publishing: boolean
  workflows: boolean
}

type BootstrapSource = {
  user: { id: string; name: string | null; email: string }
  organization: { id: string; name: string; slug: string; logo: string | null }
  organizations: ReadonlyArray<{ id: string; name: string; slug: string; role: string }>
  role: string
  settings: { locale: string; timeZone: string; defaultPublishTime: string } | null
  entitlements: { plan: string; status: string; features: Record<string, boolean> }
  capabilities: PlaybookCapabilities
  counters: { attention: number; approvals: number }
}

/**
 * Build the bootstrap by copying named fields only. Source records may carry
 * provider ids, secret references, or tokens; nothing reaches a shell unless
 * it is listed here.
 */
export function buildPlaybookBootstrap(source: BootstrapSource): PlaybookBootstrap {
  const role = normalizeOrganizationRole(source.role)
  return {
    user: { email: source.user.email, id: source.user.id, name: source.user.name },
    organization: {
      id: source.organization.id,
      logo: source.organization.logo,
      name: source.organization.name,
      slug: source.organization.slug,
    },
    organizations: source.organizations.map((organization) => ({
      id: organization.id,
      name: organization.name,
      role: normalizeOrganizationRole(organization.role),
      slug: organization.slug,
    })),
    membership: { permissions: [...getRolePermissions(role)], role },
    workspace: {
      defaultPublishTime: source.settings?.defaultPublishTime ?? '09:00',
      locale: source.settings?.locale ?? 'en',
      timeZone: source.settings?.timeZone ?? 'UTC',
    },
    entitlements: {
      features: { ...source.entitlements.features },
      plan: source.entitlements.plan,
      status: source.entitlements.status,
    },
    capabilities: {
      browserAutomation: source.capabilities.browserAutomation,
      engineeringAgent: source.capabilities.engineeringAgent,
      publishing: source.capabilities.publishing,
      voiceCapture: source.capabilities.voiceCapture,
      workflows: source.capabilities.workflows,
    },
    counters: { approvals: source.counters.approvals, attention: source.counters.attention },
  }
}
