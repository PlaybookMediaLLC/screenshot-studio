import { Megaphone01Icon } from 'hugeicons-react'
import type { Metadata } from 'next'
import { CampaignList } from '@/components/campaigns/CampaignList'
import { ButtonLink } from '@/components/platform-shell/ButtonLink'
import { PlatformShell } from '@/components/platform-shell/PlatformShell'
import { EmptyState, Page } from '@/components/platform-ui'
import { listCampaigns } from '@/lib/tenant/campaigns'
import { requireCampaignPageAccess } from './page-access'

export const metadata: Metadata = { title: 'Campaigns | Screenshot Studio' }

type CampaignsPageProps = {
  params: Promise<{ locale: string }>
}

export default async function CampaignsPage({ params }: CampaignsPageProps) {
  const { locale } = await params
  const access = await requireCampaignPageAccess(locale)
  const campaigns = await listCampaigns(access.organization.id)

  return (
    <PlatformShell campaignsEnabled organizationName={access.organization.name}>
      <Page
        actions={<ButtonLink href="/campaigns/new">New campaign</ButtonLink>}
        description="Each campaign starts from a release brief and keeps its context as you build it out."
        title="Campaigns"
      >
        {campaigns.length === 0 ? (
          <EmptyState
            action={
              <ButtonLink href="/campaigns/new" variant="outline">
                Create a campaign
              </ButtonLink>
            }
            description="Tell us what you shipped and we will keep a campaign draft for it."
            icon={Megaphone01Icon}
            title="No campaigns yet"
          />
        ) : (
          <CampaignList
            campaigns={campaigns.map((campaign) => ({
              id: campaign.id,
              name: campaign.name,
              objective: campaign.objective,
              releaseTitle: campaign.release?.title ?? null,
              status: campaign.status,
              updatedAt: campaign.updatedAt.toISOString(),
            }))}
          />
        )}
      </Page>
    </PlatformShell>
  )
}
