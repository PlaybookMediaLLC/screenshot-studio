'use client'

import {
  Activity,
  House,
  Palette,
  Megaphone,
  Send,
  FolderOpen,
  Workflow,
  Settings2,
  Menu,
  ChevronsUpDown,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'
import { PLATFORM_DESTINATIONS, platformArea } from '@/lib/platform/navigation'
import { ShellActions, ShellSearch } from './ShellActions'
import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { usePathname } from 'next/navigation'
import { type ComponentType, useEffect, useState } from 'react'
import { NotificationCenter } from '@/components/notifications/NotificationCenter'
import { UserAvatar } from '@/components/auth/UserAvatar'
import { AccountMenu } from '@/components/auth/AccountMenu'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useHydratedSession } from '@/lib/auth/client'
import { cn } from '@/lib/utils'
import { usePreferences } from '@/components/settings/PreferencesProvider'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { DYNAMIC_NAVIGATION_QUERY } from '@/lib/settings/appearance'
import type { navigationLayoutSchema } from '@/lib/api/contracts/settings-platform'
import type { z } from 'zod'
import { surface } from './shell-config'
import { Button } from '@/components/ui/button'
import { SidebarLink } from './SidebarLink'

type IconComponent = ComponentType<{ className?: string; size?: number; strokeWidth?: number }>
type NavItem = {
  href: string
  icon: IconComponent
  label: string
  key: (typeof PLATFORM_DESTINATIONS)[number]['key']
}

const ICONS = {
  home: House,
  create: Palette,
  campaigns: Megaphone,
  publish: Send,
  library: FolderOpen,
  automate: Workflow,
  activity: Activity,
  settings: Settings2,
}
const NAV_GROUPS = [
  { items: PLATFORM_DESTINATIONS.slice(0, 6) },
  { items: PLATFORM_DESTINATIONS.slice(6), label: 'Workspace' },
].map((group) => ({
  ...group,
  items: group.items.map((item) => ({ ...item, icon: ICONS[item.key] })),
}))

function NavLink({
  collapsed,
  item: { href, icon: Icon, key },
  onNavigate,
}: {
  collapsed: boolean
  item: NavItem
  onNavigate?: () => void
}) {
  const t = useTranslations('platformNavigation')
  const label = t(key)
  const pathname = usePathname()
  const active = platformArea(pathname) === platformArea(href)
  const rowClassName = cn(
    'flex h-10 items-center gap-2.5 rounded-lg border px-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    active
      ? cn(surface.panel, surface.border, 'text-foreground shadow-xs')
      : 'border-transparent text-muted-foreground hover:text-foreground',
    collapsed && 'size-10 justify-center px-0'
  )
  const link = (
    <SidebarLink
      data-platform-nav
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? label : undefined}
      className={rowClassName}
      href={href}
      onClick={onNavigate}
    >
      <Icon aria-hidden="true" className="shrink-0" size={20} strokeWidth={2} />
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
  const t = useTranslations('platformNavigation')
  return (
    <nav aria-label={t('workspace')} className="flex min-h-full flex-col gap-4">
      <ShellActions
        collapsed={collapsed}
        campaignsEnabled={campaignsEnabled}
        draftsEnabled={draftsEnabled}
        onNavigate={onNavigate}
      />
      {NAV_GROUPS.map((group, index) => (
        <div
          className={cn('grid gap-0.5', index === 1 && 'mt-auto border-t border-border pt-3')}
          key={index}
        >
          {index === 1 ? <NotificationCenter collapsed={collapsed} /> : null}
          {group.label && !collapsed ? (
            <p className="mb-1.5 px-2 text-xs font-medium text-muted-foreground/75">
              {t('workspace')}
            </p>
          ) : null}
          {group.items
            .filter((item) => campaignsEnabled || item.href !== '/campaigns')
            .filter((item) => draftsEnabled || item.href !== '/write')
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
  const { data: session } = useHydratedSession()
  return (
    <AccountMenu
      scope="account"
      workspaceName={organizationName}
      align={collapsed ? 'end' : 'start'}
      side={collapsed ? 'right' : 'top'}
      triggerClassName={cn(
        'flex h-11 w-full items-center gap-2.5 rounded-lg px-2 text-left transition-colors hover:bg-foreground/[0.04]',
        collapsed && 'size-10 justify-center px-0'
      )}
    >
      <UserAvatar
        name={session?.user.name || session?.user.email || 'Account'}
        image={session?.user.image}
        className="size-6"
      />
      {collapsed ? null : (
        <>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-foreground">
              {session?.user.name || 'Account'}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {session?.user.email ?? 'Account'}
            </span>
          </span>
          <ChevronsUpDown className="shrink-0 text-muted-foreground" size={14} />
        </>
      )}
    </AccountMenu>
  )
}

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <SidebarLink className="flex min-w-0 items-center gap-2.5" href="/home" aria-label="Shots Home">
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
function useNavigationExpanded(
  initial: z.infer<typeof navigationLayoutSchema>,
  variant: 'editor' | 'page'
) {
  const preferences = usePreferences().preferences
  const { data: session } = useHydratedSession()
  const layout =
    variant === 'editor' && !preferences?.version && initial === 'expanded'
      ? 'compact'
      : (preferences?.navigation ?? initial)
  const wide = useMediaQuery(DYNAMIC_NAVIGATION_QUERY)
  const pathname = usePathname()
  const [temporary, setTemporary] = useState<boolean | null>(null)
  const key = session
    ? `shots:nav:${session.user.id}:${session.session.activeOrganizationId}:${variant}:${platformArea(pathname)}:${preferences?.navigation ?? initial}`
    : null
  useEffect(() => {
    let remembered: string | null = null
    try {
      remembered = key ? sessionStorage.getItem(key) : null
    } catch {
      /* Browser storage is optional. */
    }
    setTemporary(remembered === 'expanded' ? true : remembered === 'compact' ? false : null)
  }, [key])
  const expanded = temporary ?? (layout === 'expanded' || (layout === 'dynamic' && wide))
  return {
    expanded,
    setTemporary: (value: boolean) => {
      setTemporary(value)
      try {
        if (key) sessionStorage.setItem(key, value ? 'expanded' : 'compact')
      } catch {
        /* Keep the current session usable without storage. */
      }
    },
  }
}

/**
 * Desktop: section icons in the fixed rail, with labels in tooltips.
 * Mobile: a full drawer of the same links.
 */
export function PlatformSidebar({
  campaignsEnabled,
  draftsEnabled = false,
  initialNavigation = 'expanded',
  organizationName = 'Workspace',
  variant,
}: PlatformSidebarProps) {
  const t = useTranslations('platformNavigation')
  // Keep the same account position in every workspace.
  const [mobileOpen, setMobileOpen] = useState(false)
  const navigation = useNavigationExpanded(initialNavigation, variant)
  const collapsed = !navigation.expanded

  return (
    <>
      <ShellSearch campaignsEnabled={campaignsEnabled} draftsEnabled={draftsEnabled} />
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
          <AccountMenu
            scope="workspace"
            workspaceName={organizationName}
            align="start"
            triggerClassName="mt-3 flex h-10 max-w-full items-center gap-2 rounded-lg px-2 text-start text-sm hover:bg-muted"
          >
            {collapsed ? (
              <ChevronsUpDown size={20} aria-hidden="true" />
            ) : (
              <>
                <span className="min-w-0 flex-1 truncate">{organizationName}</span>
                <ChevronsUpDown size={16} aria-hidden="true" />
              </>
            )}
          </AccountMenu>
        </div>

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto px-1 pt-1 [scrollbar-width:none]">
          <Navigation
            campaignsEnabled={campaignsEnabled}
            collapsed={collapsed}
            draftsEnabled={draftsEnabled}
          />
        </div>

        {
          <div className={cn('flex w-full pb-2', collapsed ? 'justify-center' : 'px-1')}>
            <Button
              aria-expanded={navigation.expanded}
              aria-label={navigation.expanded ? t('collapse') : t('expand')}
              className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground"
              onClick={() => navigation.setTemporary(!navigation.expanded)}
              size={null}
              type="button"
              variant="custom"
            >
              {navigation.expanded ? (
                <PanelLeftClose size={20} aria-hidden="true" />
              ) : (
                <PanelLeftOpen size={20} aria-hidden="true" />
              )}
            </Button>
          </div>
        }

        {
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
        }
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
              aria-label={t('openNavigation')}
              className="grid size-11 place-items-center rounded-lg text-foreground/65 hover:bg-foreground/[0.04] hover:text-foreground"
              type="button"
            >
              <Menu size={18} strokeWidth={1.8} />
            </Button>
          </SheetTrigger>
          <SheetContent
            className={cn('w-72 gap-0 border-foreground/[0.06] p-3', surface.base)}
            side="left"
          >
            <SheetTitle className="sr-only">{t('navigation')}</SheetTitle>
            <div className="px-2 py-1">
              <Brand collapsed={false} />
              <AccountMenu
                scope="workspace"
                workspaceName={organizationName}
                align="start"
                triggerClassName="mt-3 flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-2 text-start text-sm hover:bg-muted"
              >
                <span className="truncate">{organizationName}</span>
                <ChevronsUpDown size={20} aria-hidden="true" />
              </AccountMenu>
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
        <div className="ms-auto">
          <NotificationCenter />
        </div>
      </header>
    </>
  )
}
