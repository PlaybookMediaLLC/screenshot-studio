import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { platformHref } from '@/lib/platform/navigation'
import { PlatformShell } from '@/components/platform-shell/PlatformShell'
import { Page } from '@/components/platform-ui'
import { NeedsAttention } from '@/components/platform-hub/NeedsAttention'
import { RecentWork } from '@/components/platform-hub/RecentWork'
import { ResourceCards } from '@/components/platform-hub/ResourceCards'
import { requirePaidPageAccess } from '@/lib/auth/page-access'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'

export const metadata = { title: 'Home' }
export default async function HomePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams])
  // Localized legacy editor bookmarks reach this page after locale routing.
  if (['project', 'editor', 'storeProject'].some((key) => query[key] !== undefined)) {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) {
      for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value])
        search.append(key, item)
    }
    redirect(platformHref(locale === 'en' ? '/' : `/${locale}`, `/?${search}`))
  }
  const access = await requirePaidPageAccess(await headers(), locale, '/home')
  return (
    <PlatformShell
      campaignsEnabled={access.campaignWorkflowEnabled}
      organizationName={access.organization?.name}
    >
      <Page
        title="Home"
        description={`Your work in ${access.organization?.name ?? 'this workspace'}. Pick up where you left off, or start something new.`}
      >
        <RecentWork
          organizationId={access.organization!.id}
          draftsEnabled={contentDraftsEnabled()}
        />
        <NeedsAttention />
        <section className="space-y-4">
          <h2 className="text-lg font-medium">Start something</h2>
          <ResourceCards
            items={[
              {
                title: 'Create a visual',
                description: 'Polish a screenshot or compose a new design.',
                href: '/create',
                scope: 'Create',
              },
              ...(contentDraftsEnabled()
                ? [
                    {
                      title: 'Write, plan and publish',
                      description: 'Draft a post for your publishing brand.',
                      href: '/write',
                      scope: 'Publish',
                    },
                  ]
                : []),
              ...(access.campaignWorkflowEnabled
                ? [
                    {
                      title: 'Plan a campaign',
                      description: 'Turn product evidence into reviewed deliverables.',
                      href: '/campaigns/new',
                      scope: 'Campaigns',
                    },
                  ]
                : []),
              {
                title: 'Automate repeatable work',
                description: 'Prepare campaign drafts from release sources.',
                href: '/workflows',
                scope: 'Automate',
              },
            ]}
          />
        </section>
      </Page>
    </PlatformShell>
  )
}
