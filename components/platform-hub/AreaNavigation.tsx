'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import { SidebarLink } from '@/components/platform-shell/SidebarLink'
import { withoutLocale } from '@/lib/settings/appearance'
import { cn } from '@/lib/utils'

/** Route tabs preserve browser navigation and distinguish links from in-page tabs. */
export function AreaNavigation({
  label,
  items,
}: {
  label: string
  items: { href: string; label: string }[]
}) {
  const currentPath = withoutLocale(usePathname())
  const pathname =
    currentPath === '/projects' || currentPath === '/assets' ? '/library' : currentPath
  const searchParams = useSearchParams()
  const params = new URLSearchParams(searchParams.toString())
  if (currentPath === '/assets') params.set('view', 'assets')
  return (
    <nav aria-label={label} className="flex flex-wrap gap-1 border-b border-border pb-3">
      {items.map((item) => {
        const [path, query] = item.href.split('?')
        const expected = new URLSearchParams(query)
        const active =
          pathname === path &&
          [...expected].every(([key, value]) => params.get(key) === value) &&
          (query ||
            !items.some(
              (other) =>
                other.href.startsWith(`${path}?`) &&
                [...new URLSearchParams(other.href.split('?')[1])].every(
                  ([key, value]) => params.get(key) === value
                )
            ))
        return (
          <SidebarLink
            data-platform-nav
            aria-current={active ? 'page' : undefined}
            className={cn(
              'inline-flex min-h-10 items-center rounded-lg px-3 text-sm',
              active
                ? 'bg-muted font-medium text-foreground'
                : 'text-muted-foreground hover:bg-muted'
            )}
            key={item.href}
            href={item.href}
          >
            {item.label}
          </SidebarLink>
        )
      })}
    </nav>
  )
}

export const LIBRARY_LINKS = [
  { href: '/library', label: 'Projects' },
  { href: '/library?view=assets', label: 'Assets' },
  { href: '/library?view=templates', label: 'Templates' },
  { href: '/library?view=brand', label: 'Brand resources' },
]
export const CAMPAIGN_LINKS = [
  { href: '/campaigns', label: 'Campaigns' },
  { href: '/campaigns/releases', label: 'Release inbox' },
  { href: '/campaigns?status=ARCHIVED', label: 'Archived' },
]
export const AUTOMATE_LINKS = [
  { href: '/workflows', label: 'Workflows' },
  { href: '/workflows/runs', label: 'Runs' },
  { href: '/workflows?view=sources', label: 'Sources' },
]
