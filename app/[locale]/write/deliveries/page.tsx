import { PlatformShell } from '@/components/platform-shell/PlatformShell'
import { Page, Pill } from '@/components/platform-ui'
import { SidebarLink } from '@/components/platform-shell/SidebarLink'
import { AreaNavigation } from '@/components/platform-hub/AreaNavigation'
import { getCampaign, listCampaigns } from '@/lib/tenant/campaigns'
import { requireDraftsPageAccess } from '../../drafts/page-access'
import { CampaignLocalTime } from '@/components/campaigns/CampaignLocalTime'

export const metadata = { title: 'Campaign deliveries' }
export default async function CampaignDeliveries({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ campaign?: string; set?: string }>
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams])
  const access = await requireDraftsPageAccess(locale, '/write/deliveries')
  const campaigns = access.campaignWorkflowEnabled ? await listCampaigns(access.tenant) : []
  const selected = campaigns.find((campaign) => campaign.id === query.campaign)
  const campaign = selected ? await getCampaign(access.tenant, selected.id) : null
  const scope = query.set ? `?set=${encodeURIComponent(query.set)}` : ''
  return (
    <PlatformShell
      campaignsEnabled={access.campaignWorkflowEnabled}
      organizationName={access.organization.name}
    >
      <Page
        title="Campaign deliveries"
        description="Campaign posts keep their original review and approval history. The Drafts calendar covers freeform writing; choose a campaign to inspect its delivery states."
      >
        <AreaNavigation
          label="Publish"
          items={[
            { href: `/write${scope}`, label: 'Drafts' },
            { href: `/write/plan${scope}`, label: 'Calendar' },
            { href: `/write/deliveries${scope}`, label: 'Campaign deliveries' },
            {
              href: `/link-preview?returnTo=${encodeURIComponent(`/write/deliveries${scope}`)}`,
              label: 'Link checks',
            },
          ]}
        />
        <nav aria-label="Choose campaign" className="flex flex-wrap gap-2">
          {campaigns.map((item) => (
            <SidebarLink
              key={item.id}
              aria-current={item.id === selected?.id ? 'page' : undefined}
              className="rounded-lg border px-3 py-2 text-sm aria-[current=page]:bg-muted"
              href={`/write/deliveries?campaign=${item.id}${query.set ? `&set=${encodeURIComponent(query.set)}` : ''}`}
            >
              {item.name}
              {item.status === 'ARCHIVED' ? ' · Archived' : ''}
            </SidebarLink>
          ))}
        </nav>
        {campaign ? (
          <section className="space-y-4">
            <h2 className="text-lg font-medium">{campaign.name}</h2>
            {campaign.status === 'ARCHIVED' ? (
              <p className="text-sm text-muted-foreground">Archived campaign · Read only</p>
            ) : null}
            {campaign.posts.length ? (
              <ul className="divide-y rounded-xl border">
                {campaign.posts.map((post) => (
                  <li className="space-y-2 p-4" key={post.id}>
                    <SidebarLink
                      className="font-medium underline"
                      href={`/campaigns/${campaign.id}/copy?channel=${encodeURIComponent(post.channel)}#post-${post.id}`}
                    >
                      {post.title || post.copy.slice(0, 100) || 'Campaign post'}
                    </SidebarLink>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span>{post.channel}</span>
                      <Pill>
                        Review:{' '}
                        {post.approvedAt
                          ? 'Approved revision'
                          : post.status === 'SCHEDULED' || post.status === 'PUBLISHED'
                            ? 'See approval history'
                            : post.status.replaceAll('_', ' ').toLowerCase()}
                      </Pill>
                      <Pill>
                        Delivery:{' '}
                        {post.scheduledPostStatus?.replaceAll('_', ' ').toLowerCase() ??
                          'Not scheduled'}
                      </Pill>
                      {post.scheduledAt ? (
                        <span>
                          <CampaignLocalTime value={post.scheduledAt.toISOString()} />
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Current readiness and scheduling are checked in campaign review.
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No campaign posts yet. Open the campaign to prepare content.</p>
            )}
          </section>
        ) : (
          <p className="text-sm text-muted-foreground">
            {campaigns.length
              ? 'Choose a campaign to inspect its posts and open the original review.'
              : 'No campaigns available in this workspace.'}
          </p>
        )}
      </Page>
    </PlatformShell>
  )
}
