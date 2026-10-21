'use client'

import {
  Activity01Icon,
  Album02Icon,
  Layers01Icon,
  ArtboardIcon,
  Folder01Icon,
  Link01Icon,
  Megaphone01Icon,
  Menu01Icon,
  NoteEditIcon,
  PaintBoardIcon,
  SlidersHorizontalIcon,
  UnfoldMoreIcon,
  WorkflowSquare03Icon,
} from 'hugeicons-react'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { type ComponentType, useEffect, useState } from 'react'
import { NotificationCenter } from '@/components/notifications/NotificationCenter'
import { AccountMenu } from '@/components/auth/AccountMenu'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useHydratedSession } from '@/lib/auth/client'
import { cn } from '@/lib/utils'
import { workspaceInitials } from '@/lib/workspace/initials'
import { usePreferences } from '@/components/settings/PreferencesProvider'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { DYNAMIC_NAVIGATION_QUERY } from '@/lib/settings/appearance'
import type { navigationLayoutSchema } from '@/lib/api/contracts/settings-platform'
import type { z } from 'zod'
import { surface } from './shell-config'
import { Button } from '@/components/ui/button'
import { EditorNavigation } from './EditorNavigation'
import { SidebarLink } from './SidebarLink'

type IconComponent = ComponentType<{ className?: string; size?: number; strokeWidth?: number }>
type NavItem = { href: string; icon: IconComponent; label: string }

const NAV_GROUPS: { items: NavItem[]; label?: string }[] = [
  {
    items: [
      { href: '/', icon: PaintBoardIcon, label: 'Editor' },
      { href: '/canvas', icon: ArtboardIcon, label: 'Canvas' },
      { href: '/projects', icon: Folder01Icon, label: 'Projects' },
      { href: '/creative-sets', icon: Layers01Icon, label: 'Story Sets' },
      { href: '/campaigns', icon: Megaphone01Icon, label: 'Campaigns' },
      { href: '/workflows', icon: WorkflowSquare03Icon, label: 'Workflows' },
      { href: '/write', icon: NoteEditIcon, label: 'Write' },
      { href: '/assets', icon: Album02Icon, label: 'Assets' },
      { href: '/link-preview', icon: Link01Icon, label: 'Link preview' },
    ],
  },
  {
    items: [
      { href: '/activity', icon: Activity01Icon, label: 'Activity' },
      // Settings has its own section menu on every settings page.
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
  const pathname = usePathname()
  const active = isActive(pathname, href)
  const rowClassName = cn(
    'flex h-8 items-center gap-2.5 rounded-lg border px-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    active
      ? cn(surface.panel, surface.border, 'text-foreground shadow-xs')
      : 'border-transparent text-muted-foreground hover:text-foreground',
    collapsed && 'size-8 justify-center px-0'
  )
  const link = (
    <SidebarLink
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? label : undefined}
      className={rowClassName}
      href={href}
      onClick={onNavigate}
    >
      <Icon className="shrink-0" size={16} strokeWidth={1.8} />
      {collapsed ? null : <span className="truncate">{label}</span>}
    </SidebarLink>
  )
  return collapsed ? (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  ) : (
    link
  )
}

function Navigation({
  campaignsEnabled,
  collapsed,
  draftsEnabled,
  onNavigate,
}: {
  campaignsEnabled: boolean
  collapsed: boolean
  draftsEnabled: boolean
  onNavigate?: () => void
}) {
  return (
    <nav aria-label="Workspace" className={cn('grid', collapsed ? 'gap-3' : 'gap-6')}>
      <NotificationCenter collapsed={collapsed} />
      {NAV_GROUPS.map((group, index) => (
        <div className="grid gap-0.5" key={index}>
          {group.label && !collapsed ? (
            <p className="mb-1.5 px-2 text-xs font-medium text-muted-foreground/75">
              {group.label}
            </p>
          ) : null}
          {group.items
            .filter((item) => campaignsEnabled || item.href !== '/campaigns')
            .filter((item) => draftsEnabled || item.href !== '/write')
            .map((item) =>
              item.href === '/' ? (
                <EditorNavigation collapsed={collapsed} key={item.href} onNavigate={onNavigate} />
              ) : (
                <NavLink
                  collapsed={collapsed}
                  item={item}
                  key={item.href}
                  onNavigate={onNavigate}
                />
              )
            )}
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
  const { data: session } = useHydratedSession()
  return (
    <AccountMenu
      workspaceName={organizationName}
      align={collapsed ? 'end' : 'start'}
      side={collapsed ? 'right' : 'top'}
      triggerClassName={cn(
        'flex h-11 w-full items-center gap-2.5 rounded-lg px-2 text-left transition-colors hover:bg-foreground/[0.04]',
        collapsed && 'size-8 justify-center px-0'
      )}
    >
      <WorkspaceBadge name={organizationName} />
      {collapsed ? null : (
        <>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-foreground">
              {organizationName}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {session?.user.email ?? 'Account'}
            </span>
          </span>
          <UnfoldMoreIcon className="shrink-0 text-muted-foreground" size={14} />
        </>
      )}
    </AccountMenu>
  )
}

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <SidebarLink className="flex min-w-0 items-center gap-2.5" href="/">
      <Image alt="" className="size-6 rounded-md" height={24} src="/logo-mark.png" width={24} />
      {collapsed ? null : (
        <span className="truncate text-sm font-semibold tracking-tight text-foreground">Shots</span>
      )}
    </SidebarLink>
  )
}

export interface PlatformSidebarProps {
  campaignsEnabled: boolean
  /** Show Drafts; content drafts are behind PLATFORM_CONTENT_DRAFTS. */
  draftsEnabled?: boolean
  /** The layout the navigation cookie names, for the first paint. */
  initialNavigation?: z.infer<typeof navigationLayoutSchema>
  organizationName?: string
  variant: 'editor' | 'page'
}

/**
 * Whether the desktop navigation shows labels. Compact never does and
 * expanded always does. Dynamic does from 1280 px wide; narrower, it shows
 * the icon rail and keeps a temporary expansion the person opened until they
 * close it or move to another page.
 */
function useNavigationExpanded(initial: z.infer<typeof navigationLayoutSchema>) {
  const layout = usePreferences().preferences?.navigation ?? initial
  const wide = useMediaQuery(DYNAMIC_NAVIGATION_QUERY)
  const pathname = usePathname()
  const [temporary, setTemporary] = useState(false)
  useEffect(() => setTemporary(false), [pathname])
  const expanded = layout === 'expanded' || (layout === 'dynamic' && (wide || temporary))
  return { canToggle: layout === 'dynamic' && !wide, expanded, setTemporary, temporary }
}

/**
 * Desktop: section icons in the fixed rail, with labels in tooltips.
 * Mobile: a full drawer of the same links.
 */
export function PlatformSidebar({
  campaignsEnabled,
  draftsEnabled = false,
  initialNavigation = 'compact',
  organizationName = 'Workspace',
  variant,
}: PlatformSidebarProps) {
  // The editor header already holds its account menu.
  const isPage = variant === 'page'
  const [mobileOpen, setMobileOpen] = useState(false)
  const navigation = useNavigationExpanded(initialNavigation)
  const collapsed = !navigation.expanded

  return (
    <>
      <aside
        aria-label="Primary navigation"
        className={cn(
          'sticky top-0 hidden h-screen shrink-0 flex-col border-r border-foreground/[0.04] py-3 md:flex',
          collapsed ? 'w-14 items-center' : 'w-60 px-2',
          surface.base
        )}
        data-navigation={collapsed ? 'compact' : 'expanded'}
      >
        <div className={cn(!collapsed && 'px-2')}>
          <Brand collapsed={collapsed} />
        </div>

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto px-1 pt-1 [scrollbar-width:none]">
          <Navigation
            campaignsEnabled={campaignsEnabled}
            collapsed={collapsed}
            draftsEnabled={draftsEnabled}
          />
        </div>

        {navigation.canToggle ? (
          <div className={cn('flex w-full pb-2', collapsed ? 'justify-center' : 'px-1')}>
            <Button
              aria-expanded={navigation.expanded}
              aria-label={navigation.expanded ? 'Collapse navigation' : 'Expand navigation'}
              className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground"
              onClick={() => navigation.setTemporary(!navigation.temporary)}
              size={null}
              type="button"
              variant="custom"
            >
              <SlidersHorizontalIcon size={15} strokeWidth={1.8} />
            </Button>
          </div>
        ) : null}

        {isPage ? (
          // In development, room for the Next.js dev badge, which otherwise
          // sits on the switcher and swallows clicks.
          <div
            className={cn(
              'flex w-full justify-center border-t border-foreground/[0.06] pt-2',
              process.env.NODE_ENV === 'development' && 'mb-12'
            )}
          >
            <WorkspaceSwitcher collapsed={collapsed} organizationName={organizationName} />
          </div>
        ) : null}
      </aside>

      <header
        className={cn(
          'sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-foreground/[0.06] px-4 md:hidden',
          surface.base
        )}
      >
        <Sheet onOpenChange={setMobileOpen} open={mobileOpen}>
          <SheetTrigger asChild>
            <Button
              variant="custom"
              size={null}
              aria-label="Open navigation"
              className="grid size-9 place-items-center rounded-lg text-foreground/65 hover:bg-foreground/[0.04] hover:text-foreground"
              type="button"
            >
              <Menu01Icon size={18} strokeWidth={1.8} />
            </Button>
          </SheetTrigger>
          <SheetContent
            className={cn('w-72 gap-0 border-foreground/[0.06] p-3', surface.base)}
            side="left"
          >
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <div className="px-2 py-1">
              <Brand collapsed={false} />
            </div>
            <div className="mt-6 min-h-0 flex-1 overflow-y-auto">
              <Navigation
                campaignsEnabled={campaignsEnabled}
                collapsed={false}
                draftsEnabled={draftsEnabled}
                onNavigate={() => setMobileOpen(false)}
              />
            </div>
            <div
              className={cn(
                'border-t border-foreground/[0.06] pt-2',
                process.env.NODE_ENV === 'development' && 'mb-12'
              )}
            >
              <WorkspaceSwitcher collapsed={false} organizationName={organizationName} />
            </div>
          </SheetContent>
        </Sheet>
        <Brand collapsed={false} />
        <div className="ml-auto">
          <NotificationCenter />
        </div>
      </header>
    </>
  )
}
