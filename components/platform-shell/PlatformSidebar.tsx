'use client'

import {
  Activity,
  Images,
  Megaphone,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  PencilRuler,
  Settings,
  type LucideIcon,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { AccountMenu } from '@/components/auth/AccountMenu'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { authClient } from '@/lib/auth/client'
import { cn } from '@/lib/utils'
import { workspaceInitials } from '@/lib/workspace/initials'
import { PLATFORM_SIDEBAR_COOKIE } from './sidebar-state'

type NavItem = { href: string; icon: LucideIcon; label: string }

const NAV_ITEMS: NavItem[] = [
  { href: '/', icon: PencilRuler, label: 'Editor' },
  { href: '/campaigns', icon: Megaphone, label: 'Campaigns' },
  { href: '/assets', icon: Images, label: 'Assets' },
  { href: '/activity', icon: Activity, label: 'Activity' },
  { href: '/workspace', icon: Settings, label: 'Settings' },
]

/** The path without a leading locale segment, e.g. /fr/assets → /assets. */
function routePath(pathname: string): string {
  return pathname.replace(/^\/[a-z]{2}(?:-[A-Z]{2})?(?=\/|$)/, '') || '/'
}

function isActive(pathname: string, href: string): boolean {
  const path = routePath(pathname)
  return href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`)
}

function WorkspaceBadge({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className="grid size-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-fuchsia-500 via-violet-500 to-indigo-500 text-xs font-semibold text-white"
    >
      {workspaceInitials(name) || 'W'}
    </span>
  )
}

function NavLinks({
  collapsed,
  items,
  onNavigate,
}: {
  collapsed: boolean
  items: NavItem[]
  onNavigate?: () => void
}) {
  const pathname = usePathname()
  return (
    <nav aria-label="Workspace" className="grid gap-0.5">
      {items.map(({ href, icon: Icon, label }) => {
        const active = isActive(pathname, href)
        const link = (
          <Link
            aria-current={active ? 'page' : undefined}
            aria-label={collapsed ? label : undefined}
            className={cn(
              'flex h-9 items-center gap-3 rounded-lg px-2.5 text-sm font-medium transition-colors',
              active
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              collapsed && 'justify-center px-0'
            )}
            href={href}
            onClick={onNavigate}
          >
            <Icon aria-hidden className="size-[18px] shrink-0" strokeWidth={1.75} />
            {collapsed ? null : <span className="truncate">{label}</span>}
          </Link>
        )
        return collapsed ? (
          <Tooltip key={href}>
            <TooltipTrigger asChild>{link}</TooltipTrigger>
            <TooltipContent side="right">{label}</TooltipContent>
          </Tooltip>
        ) : (
          <div key={href}>{link}</div>
        )
      })}
    </nav>
  )
}

function AccountRow({ collapsed }: { collapsed: boolean }) {
  const { data: session } = authClient.useSession()
  return (
    <div className={cn('flex items-center gap-3', collapsed && 'justify-center')}>
      <AccountMenu side={collapsed ? 'right' : 'top'} />
      {collapsed || !session ? null : (
        <div className="min-w-0 text-xs">
          <p className="truncate font-medium">{session.user.name || 'Account'}</p>
          <p className="truncate text-muted-foreground">{session.user.email}</p>
        </div>
      )}
    </div>
  )
}

export interface PlatformSidebarProps {
  campaignsEnabled: boolean
  defaultCollapsed: boolean
  organizationName?: string
  showAccount: boolean
  showMobileBar: boolean
}

export function PlatformSidebar({
  campaignsEnabled,
  defaultCollapsed,
  organizationName = 'Workspace',
  showAccount,
  showMobileBar,
}: PlatformSidebarProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const [mobileOpen, setMobileOpen] = useState(false)
  const items = NAV_ITEMS.filter((item) => campaignsEnabled || item.href !== '/campaigns')

  function toggle() {
    const next = !collapsed
    setCollapsed(next)
    document.cookie = `${PLATFORM_SIDEBAR_COOKIE}=${next ? 'collapsed' : 'expanded'}; path=/; max-age=31536000; samesite=lax`
  }

  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose
  const toggleLabel = collapsed ? 'Expand sidebar' : 'Collapse sidebar'

  return (
    <>
      <aside
        className={cn(
          'sticky top-0 hidden h-screen shrink-0 flex-col border-r border-foreground/10 bg-background py-3 transition-[width] duration-200 ease-out md:flex',
          collapsed ? 'w-[60px] px-2' : 'w-60 px-3'
        )}
      >
        <div className={cn('flex items-center gap-2.5 px-1', collapsed && 'flex-col px-0')}>
          <WorkspaceBadge name={organizationName} />
          {collapsed ? null : (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{organizationName}</p>
              <p className="truncate text-xs text-muted-foreground">Workspace</p>
            </div>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                aria-label={toggleLabel}
                className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                onClick={toggle}
                type="button"
              >
                <ToggleIcon aria-hidden className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{toggleLabel}</TooltipContent>
          </Tooltip>
        </div>

        <div className="mt-5 flex-1">
          <NavLinks collapsed={collapsed} items={items} />
        </div>

        {showAccount ? (
          // In development, room for the Next.js dev badge, which otherwise
          // sits on the avatar and swallows clicks.
          <div
            className={cn(
              'border-t border-foreground/10 px-1 pt-3',
              process.env.NODE_ENV === 'development' && 'mb-12'
            )}
          >
            <AccountRow collapsed={collapsed} />
          </div>
        ) : null}
      </aside>

      {showMobileBar ? (
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-foreground/10 bg-background/90 px-4 backdrop-blur md:hidden">
          <Sheet onOpenChange={setMobileOpen} open={mobileOpen}>
            <SheetTrigger asChild>
              <button
                aria-label="Open navigation"
                className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                type="button"
              >
                <Menu aria-hidden className="size-5" />
              </button>
            </SheetTrigger>
            <SheetContent className="w-72 gap-0 p-3" side="left">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <div className="flex items-center gap-2.5 px-1 py-1">
                <WorkspaceBadge name={organizationName} />
                <p className="truncate text-sm font-semibold">{organizationName}</p>
              </div>
              <div className="mt-5 flex-1">
                <NavLinks collapsed={false} items={items} onNavigate={() => setMobileOpen(false)} />
              </div>
              <div className="border-t border-foreground/10 px-1 pt-3">
                <AccountRow collapsed={false} />
              </div>
            </SheetContent>
          </Sheet>
          <WorkspaceBadge name={organizationName} />
          <p className="min-w-0 flex-1 truncate text-sm font-semibold">{organizationName}</p>
        </header>
      ) : null}
    </>
  )
}
