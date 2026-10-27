'use client'

import { SidebarLink } from '@/components/platform-shell/SidebarLink'
import { publishLinks } from '@/lib/platform/navigation'
import { cn } from '@/lib/utils'

const ACTIVE = {
  drafts: 'Drafts',
  plan: 'Calendar',
  analyze: 'Analyze',
  deliveries: 'Campaign deliveries',
  links: 'Link checks',
}

const ANALYZE_LINKS = [
  { href: '/write/analyze', label: 'Overview' },
  { href: '/write/analyze/posting-times', label: 'Best times and posting slots' },
  { href: '/write/analyze/observations', label: 'Recorded observations and CSV' },
]

/**
 * The Publish tab bar, pinned in the same place on every Publish page.
 * `scope` keeps the publishing brand; Campaign deliveries needs campaigns.
 */
export function WorkspaceNav({
  active,
  campaigns = false,
  scope = '',
  returnTo,
}: {
  active: keyof typeof ACTIVE
  campaigns?: boolean
  scope?: string
  returnTo?: string
}) {
  return (
    <TabRow
      label="Publish"
      active={ACTIVE[active]}
      items={publishLinks(scope, returnTo, campaigns)}
    />
  )
}

/** Analyze's own pages, as a second row under the Publish tabs. */
export function AnalyzeNav({ active, scope = '' }: { active: string; scope?: string }) {
  return (
    <TabRow
      label="Analyze"
      active={active}
      items={ANALYZE_LINKS.map((item) => ({ ...item, href: `${item.href}${scope}` }))}
      secondary
    />
  )
}

function TabRow({
  active,
  items,
  label,
  secondary = false,
}: {
  active: string
  items: { href: string; label: string }[]
  label: string
  secondary?: boolean
}) {
  return (
    <nav
      aria-label={label}
      className={cn(
        'flex shrink-0 gap-1 overflow-x-auto px-3 [scrollbar-width:none]',
        secondary ? 'py-2' : 'border-b border-border py-2'
      )}
    >
      {items.map(({ href, label: name }) => (
        <SidebarLink
          aria-current={name === active ? 'page' : undefined}
          className={cn(
            'platform-tab',
            secondary && 'h-8 px-3 text-[13px]',
            name === active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
          )}
          href={href}
          key={name}
        >
          {name}
        </SidebarLink>
      ))}
    </nav>
  )
}
