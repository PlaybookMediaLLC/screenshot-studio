import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { ButtonLink } from '@/components/platform-shell/ButtonLink'
import { PlatformShell } from '@/components/platform-shell/PlatformShell'
import { AreaNavigation, LIBRARY_LINKS } from '@/components/platform-hub/AreaNavigation'
import { Page } from '@/components/platform-ui'
import { ProjectLibrary } from '@/components/projects/ProjectLibrary'
import { requirePaidPageAccess } from '@/lib/auth/page-access'
import { hasPermission } from '@/lib/auth/permissions'

export const metadata: Metadata = { title: 'Projects' }

type ProjectsPageProps = {
  params: Promise<{ locale: string }>
}

export default async function ProjectsPage({ params }: ProjectsPageProps) {
  const [{ locale }, requestHeaders] = await Promise.all([params, headers()])
  const access = await requirePaidPageAccess(requestHeaders, locale, '/projects')

  return (
    <PlatformShell
      campaignsEnabled={access.campaignWorkflowEnabled}
      organizationName={access.organization?.name ?? ''}
    >
      <Page
        actions={<ButtonLink href="/">Open editor</ButtonLink>}
        description="Designs your team keeps working on, with every saved version."
        title="Projects"
      >
        <AreaNavigation label="Library" items={LIBRARY_LINKS} />
        <ProjectLibrary canEdit={hasPermission(access.role, 'artifact:edit')} />
      </Page>
    </PlatformShell>
  )
}
