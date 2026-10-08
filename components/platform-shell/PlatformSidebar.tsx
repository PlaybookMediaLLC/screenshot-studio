'use client'

import {
  Activity01Icon,
  Album02Icon,
  Megaphone01Icon,
  Menu01Icon,
  PaintBoardIcon,
  SidebarLeftIcon,
  SlidersHorizontalIcon,
  UnfoldMoreIcon,
} from 'hugeicons-react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { type ComponentType, useState } from 'react'
import { AccountMenu } from '@/components/auth/AccountMenu'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { authClient } from '@/lib/auth/client'
import { cn } from '@/lib/utils'
import { workspaceInitials } from '@/lib/workspace/initials'
import { PLATFORM_SIDEBAR_COOKIE, surface } from './shell-config'

type IconComponent = ComponentType<{ className?: string; size?: number; strokeWidth?: number }>
type NavItem = { href: string; icon: IconComponent; label: string }

const NAV_GROUPS: { items: NavItem[]; label?: string }[] = [
  {
    items: [
      { href: '/', icon: PaintBoardIcon, label: 'Editor' },
      { href: '/campaigns', icon: Megaphone01Icon, label: 'Campaigns' },
      { href: '/assets', icon: Album02Icon, label: 'Assets' },
    ],
  },
  {
    items: [
      { href: '/activity', icon: Activity01Icon, label: 'Activity' },
      { href: '/workspace', icon: SlidersHorizontalIcon, label: 'Settings' },
    ],
    label: 'Workspace',
  },
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
      className="grid size-6 shrink-0 place-items-center rounded-md bg-gradient-to-br from-fuchsia-500 via-violet-500 to-indigo-500 text-[10px] font-semibold text-white"
    >
      {workspaceInitials(name) || 'W'}
    </span>
  )
}

function NavLink({
  collapsed,
  item: { href, icon: Icon, label },
  onNavigate,
}: {
  collapsed: boolean
  item: NavItem
  onNavigate?: () => void
}) {
  const active = isActive(usePathname(), href)
  const link = (
    <Link
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? label : undefined}
      className={cn(
        // Polar-style: quiet text that brightens on hover, and a raised pill
        // one surface lighter for the current page instead of an accent color.
        'flex h-8 items-center gap-2.5 rounded-lg border px-2 text-sm font-medium transition-colors',
        active
          ? cn(surface.panel, surface.border, 'text-white shadow-xs')
          : 'border-transparent text-neutral-500 hover:text-neutral-200',
        collapsed && 'size-8 justify-center px-0'
      )}
      href={href}
      onClick={onNavigate}
    >
      <Icon className="shrink-0" size={16} strokeWidth={1.8} />
      {collapsed ? null : <span className="truncate">{label}</span>}
    </Link>
  )
  if (!collapsed) return link
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

function Navigation({
  campaignsEnabled,
  collapsed,
  onNavigate,
}: {
  campaignsEnabled: boolean
  collapsed: boolean
  onNavigate?: () => void
}) {
  return (
    <nav aria-label="Workspace" className="grid gap-6">
      {NAV_GROUPS.map((group, index) => (
        <div className="grid gap-0.5" key={index}>
          {group.label && !collapsed ? (
            <p className="mb-1.5 px-2 text-xs font-medium text-neutral-600">{group.label}</p>
          ) : null}
          {group.items
            .filter((item) => campaignsEnabled || item.href !== '/campaigns')
            .map((item) => (
              <NavLink collapsed={collapsed} item={item} key={item.href} onNavigate={onNavigate} />
            ))}
        </div>
      ))}
    </nav>
  )
}

/** Workspace and account in one row, like a team switcher; opens the account menu. */
function WorkspaceSwitcher({
  collapsed,
  organizationName,
}: {
  collapsed: boolean
  organizationName: string
}) {
  const { data: session } = authClient.useSession()
  return (
    <AccountMenu
      align={collapsed ? 'end' : 'start'}
      side={collapsed ? 'right' : 'top'}
      triggerClassName={cn(
        'flex h-11 w-full items-center gap-2.5 rounded-lg px-2 text-left transition-colors hover:bg-white/[0.04]',
        collapsed && 'size-8 justify-center px-0'
      )}
    >
      <WorkspaceBadge name={organizationName} />
      {collapsed ? null : (
        <>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-neutral-100">
              {organizationName}
            </span>
            <span className="block truncate text-xs text-neutral-500">
              {session?.user.email ?? 'Account'}
            </span>
          </span>
          <UnfoldMoreIcon className="shrink-0 text-neutral-500" size={14} />
        </>
      )}
    </AccountMenu>
  )
}

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <Link className="flex min-w-0 items-center gap-2.5" href="/">
      <Image alt="" className="size-6 rounded-md" height={24} src="/logo-mark.png" width={24} />
      {collapsed ? null : (
        <span className="truncate text-sm font-semibold tracking-tight text-neutral-100">
          Screenshot Studio
        </span>
      )}
    </Link>
  )
}

export interface PlatformSidebarProps {
  campaignsEnabled: boolean
  defaultCollapsed: boolean
  organizationName?: string
  variant: 'editor' | 'page'
}

export function PlatformSidebar({
  campaignsEnabled,
  defaultCollapsed,
  organizationName = 'Workspace',
  variant,
}: PlatformSidebarProps) {
  // The editor brings its own logo, account menu, and mobile chrome.
  const isPage = variant === 'page'
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const [mobileOpen, setMobileOpen] = useState(false)

  function toggle() {
    const next = !collapsed
    setCollapsed(next)
    document.cookie = `${PLATFORM_SIDEBAR_COOKIE}=${next ? 'collapsed' : 'expanded'}; path=/; max-age=31536000; samesite=lax`
  }

  const toggleLabel = collapsed ? 'Expand sidebar' : 'Collapse sidebar'

  return (
    <>
      <aside
        className={cn(
          'sticky top-0 hidden h-screen shrink-0 flex-col py-3 transition-[width] duration-200 ease-out md:flex',
          surface.base,
          collapsed ? 'w-[60px] items-center px-2' : 'w-60 px-3'
        )}
      >
        <div
          className={cn(
            'flex h-8 items-center justify-between gap-2 px-2',
            collapsed && 'h-auto flex-col gap-3 px-0'
          )}
        >
          {isPage ? <Brand collapsed={collapsed} /> : <span />}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                aria-label={toggleLabel}
                className="grid size-7 shrink-0 place-items-center rounded-md text-neutral-500 transition-colors hover:bg-white/[0.04] hover:text-neutral-200"
                onClick={toggle}
                type="button"
              >
                <SidebarLeftIcon size={16} strokeWidth={1.8} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{toggleLabel}</TooltipContent>
          </Tooltip>
        </div>

        <div className="mt-6 flex-1">
          <Navigation campaignsEnabled={campaignsEnabled} collapsed={collapsed} />
        </div>

        {isPage ? (
          // In development, room for the Next.js dev badge, which otherwise
          // sits on the switcher and swallows clicks.
          <div
            className={cn(
              'w-full border-t border-white/[0.06] pt-2',
              collapsed && 'flex justify-center',
              process.env.NODE_ENV === 'development' && 'mb-12'
            )}
          >
            <WorkspaceSwitcher collapsed={collapsed} organizationName={organizationName} />
          </div>
        ) : null}
      </aside>

      {isPage ? (
        <header
          className={cn(
            'sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-white/[0.06] px-4 md:hidden',
            surface.base
          )}
        >
          <Sheet onOpenChange={setMobileOpen} open={mobileOpen}>
            <SheetTrigger asChild>
              <button
                aria-label="Open navigation"
                className="grid size-9 place-items-center rounded-lg text-neutral-400 hover:bg-white/[0.04] hover:text-neutral-100"
                type="button"
              >
                <Menu01Icon size={18} strokeWidth={1.8} />
              </button>
            </SheetTrigger>
            <SheetContent
              className={cn('w-72 gap-0 border-white/[0.06] p-3', surface.base)}
              side="left"
            >
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <div className="px-2 py-1">
                <Brand collapsed={false} />
              </div>
              <div className="mt-6 flex-1">
                <Navigation
                  campaignsEnabled={campaignsEnabled}
                  collapsed={false}
                  onNavigate={() => setMobileOpen(false)}
                />
              </div>
              <div
                className={cn(
                  'border-t border-white/[0.06] pt-2',
                  process.env.NODE_ENV === 'development' && 'mb-12'
                )}
              >
                <WorkspaceSwitcher collapsed={false} organizationName={organizationName} />
              </div>
            </SheetContent>
          </Sheet>
          <Brand collapsed={false} />
        </header>
      ) : null}
    </>
  )
}
