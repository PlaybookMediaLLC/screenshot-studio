import 'server-only'
import { platformHref, safeReturnPath } from '@/lib/platform/navigation'

import { redirect } from 'next/navigation'
import type { ListedWorkspace, Workspace } from 'screenshot-studio-backend-sdk'
import { backendSDK } from '@/lib/backend/sdk'
import { getRequestId } from './access'
import { auth } from './server'

type SignedInSession = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>

function backendPageOrganization(active: ListedWorkspace | null, workspace: Workspace | null) {
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

async function getBackendPageAccess(requestHeaders: Headers, session: SignedInSession) {
  const { active, count, workspace, features } = await backendSDK({
    organizationId: '',
    principal: {
      display: session.user.email,
      kind: 'session',
      sessionId: session.session.id,
      userId: session.user.id,
    },
    requestId: getRequestId(requestHeaders),
  }).getPageAccess()
  return {
    // PLATFORM_CAMPAIGN_WORKFLOW=enabled turns the rollout on for a whole
    // environment (local development, staging, e2e).
    campaignWorkflowEnabled:
      Boolean(workspace) &&
      (process.env.PLATFORM_CAMPAIGN_WORKFLOW === 'enabled' ||
        features['campaign:workflow'] === true),
    creativeSetsEnabled: Boolean(workspace) && features['creative-sets:create'] === true,
    hasOrganization: count > 0,
    // The onboarding agent (docs/rfcs/032). The backend decides it, including
    // the PLATFORM_ONBOARDING_AGENT rollback; without it onboarding is manual.
    onboardingAgentEnabled: Boolean(workspace) && features['onboarding:agent'] === true,
    hasBasicScheduling: features['content:drafts'] === true,
    hasPaidPlan: features['workspace:paid'] === true,
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
  const target = safeReturnPath(typeof callbackURL === 'string' ? callbackURL : null)
  redirect(platformHref(locale === 'en' ? '/' : `/${locale}`, target))
}

/**
 * The access for a product page, which needs a signed-in teammate in a
 * workspace with an active paid plan. Anyone else is sent to the step they
 * are missing: sign-in, onboarding, workspace recovery, or choosing a plan.
 */
export async function requirePaidPageAccess(
  requestHeaders: Headers,
  locale: string,
  returnTo: string,
  feature: 'workspace:paid' | 'content:drafts' = 'workspace:paid'
) {
  const access = await getPageAccess(requestHeaders)
  if (!access) {
    redirect(getLocalizedPath(locale, `/sign-in?callbackURL=${encodeURIComponent(returnTo)}`))
  }
  if (!access.hasOrganization) redirect(getLocalizedPath(locale, '/onboarding'))
  if (!access.isWorkspaceOperational) redirect(getLocalizedPath(locale, '/workspace'))
  if (!(feature === 'content:drafts' ? access.hasBasicScheduling : access.hasPaidPlan))
    redirect(getLocalizedPath(locale, '/pricing?subscribe=required'))
  return access
}
