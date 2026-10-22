'use client'

import { publicImageUrl } from '@/lib/assets/public-image'

import { PiPulse as Activity, PiHouse as House, PiPalette as Palette, PiMegaphone as Megaphone, PiPaperPlaneTilt as Send, PiFolderOpen as FolderOpen, PiFlowArrow as Workflow, PiSlidersHorizontal as Settings2, PiList as Menu, PiCaretUpDown as ChevronsUpDown, PiSidebarSimple as PanelLeftClose, PiSidebarSimple as PanelLeftOpen, PiBuilding as Building2 } from 'react-icons/pi'
import { PLATFORM_DESTINATIONS, platformArea } from '@/lib/platform/navigation'
import { ShellActions, ShellSearch } from './ShellActions'
import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { usePathname } from 'next/navigation'
import { type ComponentType, useCallback, useState, useSyncExternalStore } from 'react'
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
import { ThemeToggle } from './ThemeToggle'

type IconComponent = ComponentType<{ className?: string; size?: number }>
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
    'flex h-10 items-center gap-3 rounded-xl border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    active
      ? cn(surface.panel, surface.border, 'text-foreground shadow-xs')
      : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
    collapsed && 'size-11 justify-center px-0'
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
      <Icon aria-hidden="true" className="shrink-0" size={20} />
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
    <nav aria-label={t('workspace')} className="flex min-h-full flex-col gap-5">
      <ShellActions
        collapsed={collapsed}
        campaignsEnabled={campaignsEnabled}
        draftsEnabled={draftsEnabled}
        onNavigate={onNavigate}
      />
      {NAV_GROUPS.map((group, index) => (
        <div
          className={cn('grid gap-1', index === 1 && 'mt-auto border-t border-border pt-3')}
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
        'flex h-11 min-w-0 w-full items-center gap-2.5 rounded-lg px-2 text-left transition-colors hover:bg-foreground/[0.04]',
        collapsed && 'size-11 justify-center px-0'
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
      <Image
        alt=""
        className="size-6 rounded-md"
        height={24}
        src={publicImageUrl('/logo-mark.png')}
        width={24}
      />
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

const navigationOverrides = new Map<string, boolean>()
function subscribeNavigation(callback: () => void) {
  window.addEventListener('shots:navigation', callback)
  return () => window.removeEventListener('shots:navigation', callback)
}

/** Keep the user's toggle across destinations and editor/page shell remounts. */
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
  const key = session
    ? `shots:nav:${session.user.id}:${session.session.activeOrganizationId}:${preferences?.navigation ?? initial}`
    : null
  const temporary = useSyncExternalStore(
    subscribeNavigation,
    useCallback(() => {
      if (!key) return null
      if (navigationOverrides.has(key)) return navigationOverrides.get(key)!
      try {
        const remembered = sessionStorage.getItem(key)
        return remembered === 'expanded' ? true : remembered === 'compact' ? false : null
      } catch {
        return null
      }
    }, [key]),
    () => null
  )
  return {
    expanded: temporary ?? (layout === 'expanded' || (layout === 'dynamic' && wide)),
    setTemporary: (value: boolean) => {
      if (!key) return
      navigationOverrides.set(key, value)
      try {
        sessionStorage.setItem(key, value ? 'expanded' : 'compact')
      } catch {
        /* The in-memory override still survives client navigation. */
      }
      window.dispatchEvent(new Event('shots:navigation'))
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
          'hidden h-full shrink-0 flex-col py-4 md:flex',
          collapsed ? 'w-[76px] items-center px-3' : 'w-64 px-3',
          surface.base
        )}
        data-navigation={collapsed ? 'compact' : 'expanded'}
      >
        <div className={cn('w-full', collapsed ? 'flex flex-col items-center' : 'px-1')}>
          <div className={cn('flex h-8 items-center', collapsed ? 'justify-center' : 'px-2')}>
            <Brand collapsed={collapsed} />
          </div>
          <div className={cn('mt-4 flex items-center gap-1', collapsed && 'flex-col gap-2')}>
            <AccountMenu
              scope="workspace"
              workspaceName={organizationName}
              align="start"
              side={collapsed ? 'right' : 'bottom'}
              triggerClassName={cn(
                'flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-border/70 bg-card px-2.5 text-start text-sm transition-colors hover:bg-muted',
                collapsed && 'size-11 flex-none justify-center px-0'
              )}
            >
              <span
                aria-hidden="true"
                className="grid size-6 shrink-0 place-items-center rounded-md bg-foreground/[0.06] text-muted-foreground"
              >
                <Building2 size={15} />
              </span>
              {!collapsed && (
                <>
                  <span className="min-w-0 flex-1 truncate font-medium">{organizationName}</span>
                  <ChevronsUpDown
                    size={14}
                    className="shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                </>
              )}
            </AccountMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-expanded={navigation.expanded}
                  aria-label={navigation.expanded ? t('collapse') : t('expand')}
                  className={cn(
                    'grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground',
                    collapsed && 'w-11'
                  )}
                  onClick={() => navigation.setTemporary(!navigation.expanded)}
                  size={null}
                  type="button"
                  variant="custom"
                >
                  {navigation.expanded ? (
                    <PanelLeftClose size={18} aria-hidden="true" />
                  ) : (
                    <PanelLeftOpen size={18} aria-hidden="true" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {navigation.expanded ? t('collapse') : t('expand')}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        <div className="mt-4 min-h-0 w-full flex-1 overflow-y-auto px-1 pt-1">
          <Navigation
            campaignsEnabled={campaignsEnabled}
            collapsed={collapsed}
            draftsEnabled={draftsEnabled}
          />
        </div>

        {
          // In development, room for the Next.js dev badge, which otherwise
          // sits on the switcher and swallows clicks.
          <div
            className={cn(
              'flex w-full items-center justify-center gap-1 border-t border-border pt-3',
              collapsed && 'flex-col-reverse',
              process.env.NODE_ENV === 'development' && 'mb-12'
            )}
          >
            <WorkspaceSwitcher collapsed={collapsed} organizationName={organizationName} />
            <ThemeToggle />
          </div>
        }
      </aside>

      <header
        className={cn(
          'z-30 flex h-14 shrink-0 items-center gap-3 border-b border-foreground/[0.06] px-4 md:hidden',
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
              <Menu size={18} />
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
        <div className="ms-auto flex items-center gap-1">
          <ThemeToggle />
          <NotificationCenter />
        </div>
      </header>
    </>
  )
}
