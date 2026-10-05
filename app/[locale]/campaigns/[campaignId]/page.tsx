import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { CampaignBrief } from '@/components/campaigns/CampaignBrief'
import { Badge } from '@/components/ui/badge'
import { AppHeader } from '@/components/workspace/AppHeader'
import { hasPermission } from '@/lib/auth/permissions'
import { getCampaign } from '@/lib/tenant/campaigns'
import { requireCampaignPageAccess } from '../page-access'

export const metadata: Metadata = { title: 'Campaign | Screenshot Studio' }

type CampaignPageProps = {
  params: Promise<{ campaignId: string; locale: string }>
}

function formatTimestamp(value: Date): string {
  return value.toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })
}

/**
 * The campaign's home. Everything here is read from the server on each
 * request, so a refresh or a new session shows exactly what was saved.
 * Sections for assets and copy are placeholders until generation lands.
 */
export default async function CampaignPage({ params }: CampaignPageProps) {
  const { campaignId, locale } = await params
  const access = await requireCampaignPageAccess(locale)
  // Scoped to the active workspace: another workspace's id is a 404.
  const campaign = await getCampaign(access.organization.id, campaignId)
  if (!campaign) notFound()

  return (
    <>
      <AppHeader campaignsEnabled current="/campaigns" orgName={access.organization.name} />
      <main className="mx-auto max-w-4xl px-6 py-10">
        <header className="mb-8">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{campaign.name}</h1>
            <Badge variant="outline">{campaign.status}</Badge>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Created {formatTimestamp(campaign.createdAt)} UTC · Updated{' '}
            {formatTimestamp(campaign.updatedAt)} UTC
          </p>
        </header>

        <CampaignBrief
          campaign={{
            id: campaign.id,
            postCount: campaign.posts.length,
            status: campaign.status,
          }}
          canApprove={hasPermission(access.role, 'release:approve')}
          canEdit={hasPermission(access.role, 'release:create')}
          productSurface={campaign.productSurface}
          release={
            campaign.release && {
              ...campaign.release,
              sourceUrls: Array.isArray(campaign.release.sourceUrls)
                ? campaign.release.sourceUrls.filter((url) => typeof url === 'string')
                : [],
            }
          }
        />

        <section aria-labelledby="campaign-assets" className="mt-10">
          <h2 className="text-base font-semibold" id="campaign-assets">
            Assets
          </h2>
          <div className="mt-3 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            Screenshots and video for this release will appear here.
          </div>
        </section>

        <section aria-labelledby="campaign-copy" className="mt-10">
          <h2 className="text-base font-semibold" id="campaign-copy">
            Copy
          </h2>
          {campaign.posts.length === 0 ? (
            <div className="mt-3 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              Posts for each channel will appear here. Editing the brief keeps them intact.
            </div>
          ) : (
            <ul className="mt-3 grid gap-3">
              {campaign.posts.map((post) => (
                <li className="rounded-lg border p-4" key={post.id}>
                  <p className="text-xs font-medium uppercase text-muted-foreground">
                    {post.channel} · {post.status}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-sm">{post.copy}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  )
}
