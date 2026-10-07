import type { Metadata } from 'next'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { ButtonLink } from '@/components/platform-shell/ButtonLink'
import { PlatformShell } from '@/components/platform-shell/PlatformShell'
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
      <main className="mx-auto max-w-5xl px-6 py-10">
        <header className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Each campaign starts from a release brief and keeps its context as you build it out.
            </p>
          </div>
          <ButtonLink href="/campaigns/new">New campaign</ButtonLink>
        </header>
        {campaigns.length === 0 ? (
          <div className="rounded-lg border border-dashed p-10 text-center">
            <p className="text-sm font-medium">No campaigns yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Tell us what you shipped and we will keep a campaign draft for it.
            </p>
          </div>
        ) : (
          <ul className="divide-y rounded-lg border">
            {campaigns.map((campaign) => (
              <li key={campaign.id}>
                <Link
                  className="flex items-center justify-between gap-4 p-4 transition-colors hover:bg-muted/40"
                  href={`/campaigns/${campaign.id}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{campaign.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {campaign.release ? `Release: ${campaign.release.title}` : campaign.objective}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                    <Badge variant="outline">{campaign.status}</Badge>
                    {campaign.updatedAt.toLocaleDateString()}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </PlatformShell>
  )
}
