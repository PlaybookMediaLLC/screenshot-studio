'use client'

import { useTranslations } from 'next-intl'
import { AddIcon, SearchIcon } from './icons'
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { usePathname, useRouter } from 'next/navigation'
import { createWritingDraft } from '@/components/write/pending-draft'
import { DraftRequestError } from '@/lib/content-drafts/client'
import { prepareWorkspaceSwitch } from '@/lib/platform/navigation-guard'
import { cn } from '@/lib/utils'
import { useKeys } from '@/components/write/shortcuts'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  matchesDestination,
  PLATFORM_DESTINATIONS,
  platformArea,
  platformHref,
  withPublishAccess,
} from '@/lib/platform/navigation'
import { SidebarLink } from './SidebarLink'

const NEW_ITEMS = [
  { href: '/', label: 'Screenshot', paid: true },
  { href: '/canvas/new', label: 'Canvas', paid: true },
  { href: '/?editor=app-store', label: 'Store screenshots', paid: true },
  { href: '/write', label: 'Post', paid: false },
  { href: '/campaigns/new', label: 'Campaign', paid: true },
  { href: '/workflows/new', label: 'Workflow', paid: true },
]

/** Search beside the logo: an icon that opens the command search (⌘K). */
export function SearchButton() {
  const t = useTranslations('platformNavigation')
  const keys = useKeys()
  return (
    <Button
      data-platform-action
      variant="ghost"
      size={null}
      className="touch-hitbox grid size-8 place-items-center rounded-full p-0 text-muted-foreground hover:text-foreground"
      aria-label={t('searchCommands')}
      title={`${t('searchCommands')} (${keys.label({ key: 'k', mod: true })})`}
      onClick={() => window.dispatchEvent(new Event('shots:search'))}
    >
      <SearchIcon className="size-[18px]" aria-hidden="true" />
    </Button>
  )
}

export function ShellActions({
  collapsed,
  campaignsEnabled,
  canWriteDrafts,
  draftsEnabled,
  onNavigate,
  paidPlan = true,
}: {
  collapsed: boolean
  campaignsEnabled: boolean
  /** Without it, Post opens the drafts the member may read instead of making one. */
  canWriteDrafts: boolean
  draftsEnabled: boolean
  onNavigate?: () => void
  /** Without it, paid items say Pro and open the plan page instead of bouncing. */
  paidPlan?: boolean
}) {
  const t = useTranslations('platformNavigation')
  const router = useRouter()
  const pathname = usePathname()
  // New → Post makes the draft here, with the quick-compose box up meanwhile,
  // instead of opening Publish to click New draft again. It lands in the
  // workspace's default brand; the draft page shows that brand's library.
  const newPost = () => {
    onNavigate?.()
    // Every open editor saves or asks first; a cancelled leave stays put
    // instead of stranding the quick-compose box on the guard's error.
    void prepareWorkspaceSwitch().then(
      () =>
        createWritingDraft({}, (id) =>
          router.push(platformHref(pathname, `/write/${encodeURIComponent(id)}`))
        ),
      () => {}
    )
  }
  return (
    <div className="grid gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            data-platform-action
            variant="custom"
            size={null}
            className={cn(
              // The landing page's primary pill.
              'flex h-9 w-full items-center justify-start gap-2 rounded-full bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90',
              collapsed && 'mx-auto size-10 justify-center px-0'
            )}
            aria-label={t('new')}
          >
            <AddIcon className="size-[18px]" aria-hidden="true" />
            {!collapsed ? t('new') : null}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="platform-overlay min-w-52"
          collisionPadding={12}
        >
          {NEW_ITEMS.filter(
            (item) =>
              (campaignsEnabled || item.label !== 'Campaign') &&
              (draftsEnabled || item.label !== 'Post')
          ).map((item) =>
            item.label === 'Post' && canWriteDrafts ? (
              <DropdownMenuItem key={item.href} onSelect={newPost}>
                {item.label}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem key={item.href} asChild>
                {item.paid && !paidPlan ? (
                  <SidebarLink
                    aria-label={`${item.label} (Pro)`}
                    href={`/upgrade?from=${encodeURIComponent(item.href)}`}
                    onClick={onNavigate}
                  >
                    {item.label}
                    <span aria-hidden="true" className="platform-pro-badge ms-auto">
                      Pro
                    </span>
                  </SidebarLink>
                ) : (
                  <SidebarLink href={item.href} onClick={onNavigate}>
                    {item.label}
                  </SidebarLink>
                )}
              </DropdownMenuItem>
            )
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/** One shortcut listener owns the shell, including when the mobile menu is open. */
export function ShellSearch({
  campaignsEnabled,
  draftsEnabled,
}: {
  campaignsEnabled: boolean
  draftsEnabled: boolean
}) {
  const t = useTranslations('platformNavigation')
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const launcher = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const show = () => {
      if (
        platformArea(pathname) === 'publish' &&
        document.querySelector('[data-testid="write-frame"]')
      ) {
        window.dispatchEvent(new Event('shots:search-write'))
        return
      }
      launcher.current = document.activeElement as HTMLElement | null
      setQuery('')
      setOpen(true)
    }
    const key = (event: KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.shiftKey ||
        event.altKey ||
        event.key.toLowerCase() !== 'k'
      )
        return
      event.preventDefault()
      event.stopImmediatePropagation()
      show()
    }
    window.addEventListener('keydown', key, true)
    window.addEventListener('shots:search', show)
    return () => {
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('shots:search', show)
    }
  }, [pathname])
  const items = PLATFORM_DESTINATIONS.filter(
    (item) =>
      (campaignsEnabled || item.key !== 'campaigns') &&
      matchesDestination(item.key, t(item.key), query)
  ).map((item) => withPublishAccess(item, draftsEnabled))
  // Drafts are found by their text too, a moment after typing stops.
  const [term, setTerm] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setTerm(query.trim()), 200)
    return () => clearTimeout(timer)
  }, [query])
  const drafts = useQuery({
    enabled: open && draftsEnabled && term.length >= 2,
    queryKey: ['shell-search', 'drafts', term],
    queryFn: async ({ signal }) => {
      const response = await fetch(
        `/api/v1/content-drafts?${new URLSearchParams({ limit: '6', search: term })}`,
        { signal }
      )
      // A failure stays a failure: the dialog says search is unavailable, not that nothing matched.
      if (!response.ok)
        throw new DraftRequestError('Drafts could not be searched.', response.status)
      type Found = { id: string; plainText: string; title: string }
      const page = (await response.json()) as { items: Found[]; pinned: Found[] }
      // An untitled draft is named by its opening words, so results can be told apart.
      return [...page.pinned, ...page.items].slice(0, 6).map((draft) => ({
        id: draft.id,
        label:
          draft.title && draft.title !== 'Untitled draft'
            ? draft.title
            : draft.plainText.trim().slice(0, 80) || 'Untitled draft',
      }))
    },
  })
  const draftResults = term.length >= 2 ? (drafts.data ?? []) : []
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        // Pinned near the top, so the box stays put as results come and go.
        className="platform-overlay top-[12dvh] max-h-[calc(88dvh-1rem)] w-[calc(100%-2rem)] max-w-xl translate-y-0 gap-5 overflow-y-auto rounded-2xl p-5 sm:max-w-xl sm:p-6"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          launcher.current?.focus()
        }}
      >
        <DialogHeader className="text-start">
          <DialogTitle>{t('searchCommands')}</DialogTitle>
          <DialogDescription>
            This workspace · Destinations{draftsEnabled ? ' and drafts' : ''}
          </DialogDescription>
        </DialogHeader>
        <Input
          aria-label="Search destinations"
          placeholder={
            draftsEnabled
              ? 'Go to a place or find a draft… try billing or a draft’s words'
              : 'Go to… try screenshot or billing'
          }
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <nav aria-label="Search results" className="grid max-h-[50dvh] gap-1 overflow-y-auto">
          {items.map((item) => (
            <Button
              asChild
              className="min-h-11 justify-between rounded-lg font-normal"
              key={item.key}
              variant="ghost"
            >
              <SidebarLink href={item.href} onClick={() => setOpen(false)}>
                {t(item.key)}
                <span className="shrink-0 text-xs text-muted-foreground">Destination</span>
              </SidebarLink>
            </Button>
          ))}
          {draftResults.map((draft) => (
            <Button
              asChild
              className="min-h-11 justify-between rounded-lg font-normal"
              key={draft.id}
              variant="ghost"
            >
              <SidebarLink
                href={`/write/${encodeURIComponent(draft.id)}`}
                onClick={() => setOpen(false)}
              >
                <span className="min-w-0 truncate">{draft.label}</span>
                <span className="shrink-0 text-xs text-muted-foreground">Draft</span>
              </SidebarLink>
            </Button>
          ))}
          {draftsEnabled && term.length >= 2 && drafts.isError ? (
            <p role="status" className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
              Drafts could not be searched right now.
              <Button onClick={() => void drafts.refetch()} size="sm" variant="outline">
                Try again
              </Button>
            </p>
          ) : null}
          {!items.length && !draftResults.length && !drafts.isError ? (
            <p role="status" className="p-3 text-sm text-muted-foreground">
              {draftsEnabled && term.length >= 2 && drafts.isFetching
                ? 'Searching drafts…'
                : draftsEnabled
                  ? 'Nothing matches. Search finds places in Shots and drafts by their words.'
                  : 'No destinations match. Search finds places in Shots, not the work inside them.'}
            </p>
          ) : null}
        </nav>
      </DialogContent>
    </Dialog>
  )
}
