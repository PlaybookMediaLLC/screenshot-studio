import 'server-only'

import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { getLocalizedPath, getPageAccess } from '@/lib/auth/page-access'

/**
 * Shared guard for the campaign pages: signed in, in an operational
 * workspace, and inside the campaign workflow rollout. Outside the rollout
 * the pages do not exist.
 */
export async function requireCampaignPageAccess(locale: string) {
  const access = await getPageAccess(await headers())
  if (!access) redirect(getLocalizedPath(locale, '/sign-in'))
  if (!access.hasOrganization || !access.organization) {
    redirect(getLocalizedPath(locale, '/onboarding'))
  }
  if (!access.isWorkspaceOperational) redirect(getLocalizedPath(locale, '/workspace'))
  if (!access.campaignWorkflowEnabled) notFound()
  return { ...access, organization: access.organization }
}
