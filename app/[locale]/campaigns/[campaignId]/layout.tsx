import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { CampaignStatusPill } from '@/components/campaigns/CampaignStatusPill'
import { CampaignSubnav } from '@/components/launch/CampaignSubnav'
import { PlatformShell } from '@/components/platform-shell/PlatformShell'
import { Page } from '@/components/platform-ui'
import { getCampaign } from '@/lib/tenant/campaigns'
import { requireCampaignPageAccess } from '../page-access'

// Absolute: the root template would add a second suffix, and children set their own.
export const metadata: Metadata = { title: { absolute: 'Campaign | Screenshot Studio' } }

type CampaignLayoutProps = {
  children: ReactNode
  params: Promise<{ campaignId: string; locale: string }>
}

/** The frame shared by a campaign's pages: title, status, and the page tabs. */
export default async function CampaignLayout({ children, params }: CampaignLayoutProps) {
  const { campaignId, locale } = await params
  const access = await requireCampaignPageAccess(locale)
  // Scoped to the active workspace: another workspace's id is a 404.
  const campaign = await getCampaign(access.organization.id, campaignId)
  if (!campaign) notFound()

  return (
    <PlatformShell campaignsEnabled organizationName={access.organization.name}>
      <Page
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <CampaignStatusPill status={campaign.status} />
            <span>
              Updated{' '}
              {campaign.updatedAt.toLocaleString('en', {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: 'UTC',
              })}{' '}
              UTC
            </span>
          </span>
        }
        title={campaign.name}
      >
        <CampaignSubnav campaignId={campaign.id} />
        {children}
      </Page>
    </PlatformShell>
  )
}
