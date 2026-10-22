import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { platformHref } from '@/lib/platform/navigation'
import { PlatformShell } from '@/components/platform-shell/PlatformShell'
import {
  ArrowRight,
  ArrowUpRight,
  ImagePlus,
  PenLine,
  Megaphone,
  Workflow,
  Shapes,
} from 'lucide-react'
import { SidebarLink } from '@/components/platform-shell/SidebarLink'
import { ButtonLink } from '@/components/platform-shell/ButtonLink'
import { NeedsAttention } from '@/components/platform-hub/NeedsAttention'
import { RecentWork } from '@/components/platform-hub/RecentWork'
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
  const starters = [
    {
      title: 'Create a visual',
      description: 'Give your screenshots a little spotlight.',
      href: '/create',
      icon: ImagePlus,
      color: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
    },
    ...(contentDraftsEnabled()
      ? [
          {
            title: 'Write a post',
            description: 'Find the words. Make them yours.',
            href: '/write',
            icon: PenLine,
            color: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
          },
        ]
      : []),
    ...(access.campaignWorkflowEnabled
      ? [
          {
            title: 'Plan a campaign',
            description: 'Bring your next launch together.',
            href: '/campaigns/new',
            icon: Megaphone,
            color: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
          },
        ]
      : []),
    {
      title: 'Build a workflow',
      description: 'Give repeatable work a rhythm.',
      href: '/workflows',
      icon: Workflow,
      color: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    },
  ]
  return (
    <PlatformShell
      campaignsEnabled={access.campaignWorkflowEnabled}
      organizationName={access.organization?.name}
    >
      <main className="mx-auto flex w-full max-w-[1440px] flex-col gap-10 px-5 py-6 sm:px-8 lg:gap-12 lg:px-12 lg:py-8">
        <header className="flex items-center justify-between gap-4 border-b border-border/70 pb-5">
          <h1 className="text-sm font-semibold">Home</h1>
          <span className="truncate text-xs text-muted-foreground">
            {access.organization?.name ?? 'Your workspace'}
          </span>
        </header>

        <section aria-labelledby="home-welcome" className="space-y-8">
          <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
            <div className="max-w-xl">
              <p className="mb-3 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />A space
                for your next idea
              </p>
              <h2
                id="home-welcome"
                className="max-w-lg text-3xl font-semibold tracking-tight text-balance sm:text-4xl lg:text-[2.75rem] lg:leading-[1.12]"
              >
                What will you make today?
              </h2>
              <p className="mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">
                From the first screenshot to the final post. Create something new, or pick up where
                you left off.
              </p>
            </div>
            <ButtonLink
              href="/library?view=templates"
              variant="outline"
              className="w-fit shrink-0 gap-2 rounded-xl bg-background"
            >
              <Shapes size={16} aria-hidden="true" /> Explore templates{' '}
              <ArrowUpRight size={15} aria-hidden="true" />
            </ButtonLink>
          </div>
          <ul className="grid gap-3 min-[360px]:grid-cols-2 xl:grid-cols-4">
            {starters.map(({ title, description, href, icon: Icon, color }) => (
              <li key={href}>
                <SidebarLink
                  href={href}
                  className="group flex h-full flex-col rounded-2xl border border-border/80 bg-background/70 p-4 transition-colors sm:p-5 hover:border-foreground/20 hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="mb-6 flex items-start justify-between gap-3">
                    <span className={`grid size-10 place-items-center rounded-xl ${color}`}>
                      <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
                    </span>
                    <ArrowUpRight
                      size={16}
                      aria-hidden="true"
                      className="text-muted-foreground/50 transition-colors group-hover:text-foreground"
                    />
                  </span>
                  <span className="text-sm font-semibold">{title}</span>
                  <span className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                    {description}
                  </span>
                </SidebarLink>
              </li>
            ))}
          </ul>
        </section>

        <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          <RecentWork
            organizationId={access.organization!.id}
            draftsEnabled={contentDraftsEnabled()}
          />
          <NeedsAttention />
        </div>

        <SidebarLink
          href="/library?view=brand"
          className="group flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border/70 bg-background/40 px-6 py-5 transition-colors hover:bg-background"
        >
          <span className="flex items-center gap-4">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl border bg-card">
              <Shapes size={19} className="text-muted-foreground" aria-hidden="true" />
            </span>
            <span>
              <span className="block text-sm font-medium">Make it unmistakably yours</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                Keep your visuals, voice and product details in one place.
              </span>
            </span>
          </span>
          <span className="flex items-center gap-2 text-xs font-medium">
            Brand resources <ArrowRight size={15} aria-hidden="true" />
          </span>
        </SidebarLink>
      </main>
    </PlatformShell>
  )
}
