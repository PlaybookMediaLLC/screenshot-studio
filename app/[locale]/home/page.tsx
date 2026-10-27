import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { platformHref } from '@/lib/platform/navigation'
import { PlatformShell } from '@/components/platform-shell/PlatformShell'
import { ArrowRightIcon as ArrowRight } from '@phosphor-icons/react/dist/ssr/ArrowRight'
import { ArrowUpRightIcon as ArrowUpRight } from '@phosphor-icons/react/dist/ssr/ArrowUpRight'
import { ImageIcon as ImagePlus } from '@phosphor-icons/react/dist/ssr/Image'
import { PenIcon as PenLine } from '@phosphor-icons/react/dist/ssr/Pen'
import { MegaphoneIcon as Megaphone } from '@phosphor-icons/react/dist/ssr/Megaphone'
import { FlowArrowIcon as Workflow } from '@phosphor-icons/react/dist/ssr/FlowArrow'
import { ShapesIcon as Shapes } from '@phosphor-icons/react/dist/ssr/Shapes'
import { SidebarLink } from '@/components/platform-shell/SidebarLink'
import { ButtonLink } from '@/components/platform-shell/ButtonLink'
import { NeedsAttention } from '@/components/platform-hub/NeedsAttention'
import { RecentWork } from '@/components/platform-hub/RecentWork'
import { requirePaidPageAccess, unpaidLandingPath } from '@/lib/auth/page-access'
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
  const access = await requirePaidPageAccess(await headers(), locale, '/home', 'content:drafts')
  if (!access.hasPaidPlan) redirect(unpaidLandingPath(locale, access))
  const starters = [
    {
      title: 'Create a visual',
      description: 'Screenshots, mockups, and designs.',
      href: '/create',
      icon: ImagePlus,
    },
    ...(contentDraftsEnabled()
      ? [
          {
            title: 'Write a post',
            description: 'Draft and schedule your posts.',
            href: '/write',
            icon: PenLine,
          },
        ]
      : []),
    ...(access.campaignWorkflowEnabled
      ? [
          {
            title: 'Plan a campaign',
            description: 'Organize your next product launch.',
            href: '/campaigns/new',
            icon: Megaphone,
          },
        ]
      : []),
    {
      title: 'Build a workflow',
      description: 'Automate repeatable tasks.',
      href: '/workflows',
      icon: Workflow,
    },
  ]
  return (
    <PlatformShell
      campaignsEnabled={access.campaignWorkflowEnabled}
      organizationName={access.organization?.name}
    >
      <main className="platform-home mx-auto w-full max-w-[1320px] px-5 sm:px-8 lg:px-10">
        <header className="home-topbar">
          <h1 className="text-sm font-semibold">Home</h1>
          <span className="truncate text-xs text-muted-foreground">
            {access.organization?.name ?? 'Your workspace'}
          </span>
        </header>

        <section aria-labelledby="home-welcome" className="home-start">
          <div className="home-intro">
            <div className="min-w-0">
              <h2 id="home-welcome" className="home-title">
                What will you make today?
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                Start something new, or pick up where you left off.
              </p>
            </div>
            <ButtonLink
              href="/library?view=templates"
              variant="outline"
              className="w-fit shrink-0 gap-2"
            >
              <Shapes size={16} aria-hidden="true" /> Explore templates{' '}
              <ArrowUpRight size={15} aria-hidden="true" />
            </ButtonLink>
          </div>
          <ul className="home-actions">
            {starters.map(({ title, description, href, icon: Icon }) => (
              <li key={href}>
                <SidebarLink href={href} className="home-action group">
                  <span className="home-action-icon">
                    <Icon size={19} aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-foreground">{title}</span>
                    <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                      {description}
                    </span>
                  </span>
                  <ArrowUpRight size={14} aria-hidden="true" className="home-action-arrow" />
                </SidebarLink>
              </li>
            ))}
          </ul>
        </section>

        <div className="home-work">
          <RecentWork
            organizationId={access.organization!.id}
            draftsEnabled={contentDraftsEnabled()}
          />
          <NeedsAttention />
        </div>

        <SidebarLink href="/library?view=brand" className="home-brand group">
          <span className="flex items-center gap-3">
            <span className="grid size-8 shrink-0 place-items-center">
              <Shapes size={19} className="text-muted-foreground" aria-hidden="true" />
            </span>
            <span>
              <span className="block text-sm font-medium">Brand resources</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                Manage your brand kit, voice, and products.
              </span>
            </span>
          </span>
          <span className="flex items-center gap-2 text-xs font-medium">
            Manage brand <ArrowRight size={15} aria-hidden="true" />
          </span>
        </SidebarLink>
      </main>
    </PlatformShell>
  )
}
