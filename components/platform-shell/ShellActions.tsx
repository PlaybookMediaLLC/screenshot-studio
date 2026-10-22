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
import { PLATFORM_DESTINATIONS, platformArea } from '@/lib/platform/navigation'
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
        variant="ghost"
        className={cn(
          'h-10 justify-start gap-3 rounded-xl px-3',
          collapsed && 'size-11 justify-center px-0'
        )}
        aria-label={t('searchCommands')}
        title={`${t('searchCommands')} (${keys.label({ key: 'k', mod: true })})`}
        onClick={() => window.dispatchEvent(new Event('shots:search'))}
      >
        <Search size={20} aria-hidden="true" />
        {!collapsed ? (
          <>
            <span>{t('search')}</span>
            <kbd
              aria-hidden="true"
              className="ms-auto rounded border px-1 text-[10px] text-muted-foreground"
            >
              {keys.label({ key: 'k', mod: true })}
            </kbd>
          </>
        ) : null}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              'h-10 justify-start gap-3 rounded-xl px-3',
              collapsed && 'size-11 justify-center px-0'
            )}
            aria-label={t('new')}
          >
            <Plus size={20} aria-hidden="true" />
            {!collapsed ? t('new') : null}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
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
      (draftsEnabled || item.key !== 'publish') &&
      t(item.key).toLowerCase().includes(query.toLowerCase())
  )
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="w-[80vw] max-w-[80vw] gap-5 rounded-2xl p-5 sm:max-w-[80vw] sm:p-8"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          launcher.current?.focus()
        }}
      >
        <DialogHeader>
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
              className="rounded-lg px-3 py-2 text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              href={item.href}
              key={item.key}
              onClick={() => setOpen(false)}
            >
              {t(item.key)}
              <span className="ms-3 text-xs text-muted-foreground">Destination</span>
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
