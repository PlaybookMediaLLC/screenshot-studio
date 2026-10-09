import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { PlatformShell } from '@/components/platform-shell/PlatformShell'
import { WorkspaceSettings } from '@/components/workspace/WorkspaceSettings'
import { findSettingsSection } from '@/components/workspace/settings-sections'
import { getLocalizedPath, getPageAccess } from '@/lib/auth/page-access'

type WorkspacePageProps = {
  params: Promise<{ locale: string; section?: string[] }>
}

export async function generateMetadata({ params }: WorkspacePageProps): Promise<Metadata> {
  const { section } = await params
  const found = findSettingsSection(section?.[0])
  return { title: `${found?.title ?? 'Settings'} · Settings | Screenshot Studio` }
}

export default async function WorkspacePage({ params }: WorkspacePageProps) {
  const [{ locale, section: segments }, requestHeaders] = await Promise.all([params, headers()])
  const section = segments && segments.length > 1 ? undefined : findSettingsSection(segments?.[0])
  if (!section) notFound()
  const access = await getPageAccess(requestHeaders)
  if (!access) redirect(getLocalizedPath(locale, '/sign-in'))
  if (!access.hasOrganization || !access.organization) {
    redirect(getLocalizedPath(locale, '/onboarding'))
  }

  return (
    <PlatformShell
      campaignsEnabled={access.campaignWorkflowEnabled}
      organizationName={access.organization.name}
    >
      <WorkspaceSettings
        email={access.session.user.email}
        name={access.session.user.name || ''}
        organization={access.organization}
        role={access.role}
        section={section.id}
        twoFactorEnabled={Boolean(access.session.user.twoFactorEnabled)}
        userId={access.session.user.id}
      />
    </PlatformShell>
  )
}
