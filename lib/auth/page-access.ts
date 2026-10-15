import 'server-only'

import { redirect } from 'next/navigation'
import type { ListedWorkspace, Workspace } from 'screenshot-studio-backend-sdk'
import { backendSDK } from '@/lib/backend/sdk'
import { getRequestId } from './access'
import { auth } from './server'

type SignedInSession = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>

async function resolveBackendPageWorkspace(requestHeaders: Headers, session: SignedInSession) {
  const sessionAccess = {
    organizationId: '',
    principal: {
      display: session.user.email,
      kind: 'session' as const,
      sessionId: session.session.id,
      userId: session.user.id,
    },
    requestId: getRequestId(requestHeaders),
  }
  const { workspaces } = await backendSDK(sessionAccess).listWorkspaces()
  const active =
    workspaces.find((workspace) => workspace.id === session.session.activeOrganizationId) ??
    workspaces[0]
  if (active && active.id !== session.session.activeOrganizationId) {
    await backendSDK(sessionAccess).setActiveWorkspace(active.id)
  }
  return { active, count: workspaces.length, sessionAccess }
}

function backendPageOrganization(active: ListedWorkspace | undefined, workspace: Workspace | null) {
  if (!active) return null
  return {
    id: active.id,
    logo: workspace?.logo ?? null,
    name: workspace?.name ?? active.name,
    slug: workspace?.slug ?? active.slug,
    workspaceDeletion: backendPageDeletion(active),
    workspaceSettings: workspace?.workspaceSettings ?? null,
  }
}

function backendPageDeletion(active: ListedWorkspace) {
  if (!active.workspaceDeletion) return null
  return {
    ...active.workspaceDeletion,
    scheduledFor: new Date(active.workspaceDeletion.scheduledFor),
  }
}

type BackendSessionAccess = Awaited<ReturnType<typeof resolveBackendPageWorkspace>>['sessionAccess']

async function loadBackendPageWorkspace(
  active: ListedWorkspace | undefined,
  access: BackendSessionAccess
) {
  if (!active || active.isScheduledForDeletion) return null
  return (await backendSDK({ ...access, organizationId: active.id }).getWorkspace()).workspace
}

async function loadBackendCampaignFlag(
  active: ListedWorkspace | undefined,
  access: BackendSessionAccess,
  workspace: Workspace | null
) {
  if (!active || !workspace) return false
  // PLATFORM_CAMPAIGN_WORKFLOW=enabled turns the rollout on for a whole
  // environment (local development, staging, e2e).
  if (process.env.PLATFORM_CAMPAIGN_WORKFLOW === 'enabled') return true
  const bootstrap = await backendSDK({ ...access, organizationId: active.id }).getBootstrap()
  return bootstrap.entitlements.features['campaign:workflow'] === true
}

async function getBackendPageAccess(requestHeaders: Headers, session: SignedInSession) {
  const { active, count, sessionAccess } = await resolveBackendPageWorkspace(
    requestHeaders,
    session
  )
  const workspace = await loadBackendPageWorkspace(active, sessionAccess)
  return {
    campaignWorkflowEnabled: await loadBackendCampaignFlag(active, sessionAccess, workspace),
    hasOrganization: count > 0,
    isWorkspaceOperational: Boolean(workspace),
    organization: backendPageOrganization(active, workspace),
    role: active?.role ?? 'viewer',
    session,
  }
}

export async function getPageAccess(requestHeaders: Headers) {
  const session = await auth.api.getSession({
    headers: requestHeaders,
    query: { disableCookieCache: true },
  })
  if (!session) return null

  return getBackendPageAccess(requestHeaders, session)
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
