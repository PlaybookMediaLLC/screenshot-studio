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
  const active = useActiveAreaLink(items)
  return (
    <nav aria-label={label} className="platform-tabs">
      {items.map((item) => {
        const isActive = item.href === active
        return (
          <SidebarLink
            data-platform-tab
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'platform-tab',
              isActive
                ? 'font-medium text-foreground'
                : 'text-muted-foreground hover:text-foreground'
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

/**
 * The href of the area link this page is on: its path and query match, a link
 * without a query only wins when no more specific sibling matches, and failing
 * both, the link to this path.
 */
export function useActiveAreaLink(items: { href: string }[]): string | undefined {
  const currentPath = withoutLocale(usePathname())
  const pathname =
    currentPath === '/projects' || currentPath === '/assets' ? '/library' : currentPath
  const searchParams = useSearchParams()
  const params = new URLSearchParams(searchParams.toString())
  if (currentPath === '/assets') params.set('view', 'assets')
  const matches = (href: string) => {
    const [path, query] = href.split('?')
    return (
      pathname === path &&
      [...new URLSearchParams(query)].every(([key, value]) => params.get(key) === value)
    )
  }
  return (
    items.find((item) => item.href.includes('?') && matches(item.href)) ??
    items.find((item) => matches(item.href)) ??
    // A link that only carries context, like Link checks' return path, still marks its page.
    items.find((item) => item.href.split('?')[0] === pathname)
  )?.href
}

/** One row of Library categories: each kind of project, then reusable resources. */
export const LIBRARY_LINKS = [
  { href: '/library', label: 'Screenshots' },
  { href: '/library?type=canvas', label: 'Canvas' },
  { href: '/library?type=story', label: 'Story Sets' },
  { href: '/library?type=store', label: 'Store screenshots' },
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
