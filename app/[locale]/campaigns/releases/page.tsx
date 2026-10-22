import { PlatformShell } from '@/components/platform-shell/PlatformShell'
import { Page } from '@/components/platform-ui'
import { AreaNavigation, CAMPAIGN_LINKS } from '@/components/platform-hub/AreaNavigation'
import { WorkspaceActivity } from '@/components/workspace/WorkspaceActivity'
import { ButtonLink } from '@/components/platform-shell/ButtonLink'
import { requireCampaignPageAccess } from '../page-access'

export const metadata = { title: 'Release inbox' }
export default async function ReleaseInbox({ params }: { params: Promise<{ locale: string }> }) {
  const access = await requireCampaignPageAccess((await params).locale)
  return (
    <PlatformShell campaignsEnabled organizationName={access.organization.name}>
      <Page
        title="Release inbox"
        description="Product changes and source evidence for your next campaign."
        actions={
          <ButtonLink href="/workflows?view=sources" variant="outline">
            Connect a release source
          </ButtonLink>
        }
      >
        <AreaNavigation label="Campaigns" items={CAMPAIGN_LINKS} />
        <WorkspaceActivity sections={['releases']} />
      </Page>
    </PlatformShell>
  )
}
