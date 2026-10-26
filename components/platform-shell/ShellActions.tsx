'use client'

import { useTranslations } from 'next-intl'
import { PlusIcon as Plus } from '@phosphor-icons/react/dist/ssr/Plus'
import { MagnifyingGlassIcon as Search } from '@phosphor-icons/react/dist/ssr/MagnifyingGlass'
import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
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
import { PLATFORM_DESTINATIONS, platformArea, withPublishAccess } from '@/lib/platform/navigation'
import { SidebarLink } from './SidebarLink'

const NEW_ITEMS = [
  { href: '/', label: 'Screenshot' },
  { href: '/canvas/new', label: 'Canvas' },
  { href: '/?editor=app-store', label: 'Store screenshots' },
  { href: '/write', label: 'Post' },
  { href: '/campaigns/new', label: 'Campaign' },
  { href: '/workflows/new', label: 'Workflow' },
]

export function ShellActions({
  collapsed,
  campaignsEnabled,
  draftsEnabled,
  onNavigate,
}: {
  collapsed: boolean
  campaignsEnabled: boolean
  draftsEnabled: boolean
  onNavigate?: () => void
}) {
  const t = useTranslations('platformNavigation')
  const keys = useKeys()
  return (
    <div className="grid gap-1">
      <Button
        data-platform-action
        variant="ghost"
        className={cn(
          'h-10 justify-start gap-3 px-3 text-muted-foreground hover:text-foreground',
          collapsed && 'size-11 justify-center px-0'
        )}
        aria-label={t('searchCommands')}
        title={`${t('searchCommands')} (${keys.label({ key: 'k', mod: true })})`}
        onClick={() => window.dispatchEvent(new Event('shots:search'))}
      >
        <Search className="size-5" aria-hidden="true" />
        {!collapsed ? (
          <>
            <span>{t('search')}</span>
            <kbd
              aria-hidden="true"
              className="ms-auto rounded border border-border bg-card px-1.5 py-0.5 font-sans text-[10px] leading-none text-muted-foreground"
            >
              {keys.label({ key: 'k', mod: true })}
            </kbd>
          </>
        ) : null}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            data-platform-action
            variant="outline"
            className={cn(
              'h-10 justify-start gap-3 px-3',
              collapsed && 'size-11 justify-center px-0'
            )}
            aria-label={t('new')}
          >
            <Plus className="size-5" aria-hidden="true" />
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
          ).map((item) => (
            <DropdownMenuItem key={item.href} asChild>
              <SidebarLink href={item.href} onClick={onNavigate}>
                {item.label}
              </SidebarLink>
            </DropdownMenuItem>
          ))}
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
      t(item.key).toLowerCase().includes(query.toLowerCase())
  ).map((item) => withPublishAccess(item, draftsEnabled))
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="platform-overlay max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl gap-5 overflow-y-auto rounded-2xl p-5 sm:max-w-xl sm:p-6"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          launcher.current?.focus()
        }}
      >
        <DialogHeader className="text-start">
          <DialogTitle>{t('searchCommands')}</DialogTitle>
          <DialogDescription>This workspace · Destinations</DialogDescription>
        </DialogHeader>
        <Input
          aria-label="Search destinations"
          placeholder="Find a place to work…"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <nav aria-label="Search results" className="grid max-h-[50dvh] gap-1 overflow-y-auto">
          {items.map((item) => (
            <SidebarLink
              className="flex min-h-11 items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-muted"
              href={item.href}
              key={item.key}
              onClick={() => setOpen(false)}
            >
              {t(item.key)}
              <span className="shrink-0 text-xs text-muted-foreground">Destination</span>
            </SidebarLink>
          ))}
          {!items.length ? (
            <p role="status" className="p-3 text-sm text-muted-foreground">
              No destinations match.
            </p>
          ) : null}
        </nav>
      </DialogContent>
    </Dialog>
  )
}
