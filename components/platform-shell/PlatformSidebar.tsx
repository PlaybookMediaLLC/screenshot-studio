'use client'

import { publicImageUrl } from '@/lib/assets/public-image'

import { PulseIcon as Activity } from '@phosphor-icons/react/dist/ssr/Pulse'
import { HouseIcon as House } from '@phosphor-icons/react/dist/ssr/House'
import { PaletteIcon as Palette } from '@phosphor-icons/react/dist/ssr/Palette'
import { MegaphoneIcon as Megaphone } from '@phosphor-icons/react/dist/ssr/Megaphone'
import { PaperPlaneTiltIcon as Send } from '@phosphor-icons/react/dist/ssr/PaperPlaneTilt'
import { FolderOpenIcon as FolderOpen } from '@phosphor-icons/react/dist/ssr/FolderOpen'
import { FlowArrowIcon as Workflow } from '@phosphor-icons/react/dist/ssr/FlowArrow'
import { SlidersHorizontalIcon as Settings2 } from '@phosphor-icons/react/dist/ssr/SlidersHorizontal'
import { ListIcon as Menu } from '@phosphor-icons/react/dist/ssr/List'
import { CaretUpDownIcon as ChevronsUpDown } from '@phosphor-icons/react/dist/ssr/CaretUpDown'
import { SidebarSimpleIcon as PanelLeftClose } from '@phosphor-icons/react/dist/ssr/SidebarSimple'
import { SidebarSimpleIcon as PanelLeftOpen } from '@phosphor-icons/react/dist/ssr/SidebarSimple'
import { BuildingIcon as Building2 } from '@phosphor-icons/react/dist/ssr/Building'
import { PLATFORM_DESTINATIONS, platformArea, withPublishAccess } from '@/lib/platform/navigation'
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
    'flex h-10 items-center gap-3 px-3',
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
          className={cn('grid gap-1', index === 1 && 'mt-auto border-t border-border pt-4')}
          key={index}
        >
          {group.label && !collapsed ? (
            <p className="mb-1 px-3 text-[11px] font-medium tracking-wide text-muted-foreground">
              {t('workspace')}
            </p>
          ) : null}
          {index === 1 ? <NotificationCenter collapsed={collapsed} /> : null}
          {group.items
            .filter((item) => campaignsEnabled || item.href !== '/campaigns')
            .map((item) => withPublishAccess(item, draftsEnabled))
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
        'flex h-12 w-full min-w-0 items-center gap-2.5 rounded-lg px-2 text-start transition-colors hover:bg-muted',
        collapsed && 'size-11 justify-center px-0'
      )}
    >
      <UserAvatar
        name={session?.user.name || session?.user.email || 'Account'}
        image={session?.user.image}
        className="size-8 shrink-0"
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
    <SidebarLink
      className="flex min-w-0 items-center gap-2.5 rounded-md"
      href="/home"
      aria-label="Shots Home"
    >
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
  const { preferences, status } = usePreferences()
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
    ready: Boolean(key) && status !== 'loading',
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
        data-platform-sidebar
        className={cn(
          'hidden h-full shrink-0 flex-col px-3 py-5 md:flex',
          collapsed
            ? 'w-[var(--platform-nav-compact)] items-center'
            : 'w-[var(--platform-nav-expanded)]',
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
                'platform-workspace-trigger flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 text-start text-sm transition-colors',
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
                  disabled={!navigation.ready}
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

        <div className="mt-5 min-h-0 w-full flex-1 overflow-y-auto overscroll-contain px-1 py-1">
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
              'mt-3 flex w-full shrink-0 items-center justify-center gap-1 border-t border-border pt-3',
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
          'platform-mobile-header z-30 flex shrink-0 items-center gap-3 border-b border-border md:hidden',
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
            data-platform-sidebar
            className="platform-overlay platform-navigation-drawer gap-0 border-border p-3"
            side="left"
          >
            <SheetTitle className="sr-only">{t('navigation')}</SheetTitle>
            <div className="shrink-0 px-1 pt-1">
              <div className="flex h-8 items-center px-2 pe-12">
                <Brand collapsed={false} />
              </div>
              <AccountMenu
                scope="workspace"
                workspaceName={organizationName}
                align="start"
                triggerClassName="platform-workspace-trigger mt-4 flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 text-start text-sm transition-colors"
              >
                <span
                  aria-hidden="true"
                  className="grid size-6 shrink-0 place-items-center rounded-md bg-foreground/[0.06] text-muted-foreground"
                >
                  <Building2 size={15} />
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">{organizationName}</span>
                <ChevronsUpDown
                  size={14}
                  className="shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              </AccountMenu>
            </div>
            <div className="mt-5 min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 py-1">
              <Navigation
                campaignsEnabled={campaignsEnabled}
                collapsed={false}
                draftsEnabled={draftsEnabled}
                onNavigate={() => setMobileOpen(false)}
              />
            </div>
            <div
              className={cn(
                'mt-3 flex shrink-0 items-center gap-1 border-t border-border pt-3',
                process.env.NODE_ENV === 'development' && 'mb-12'
              )}
            >
              <WorkspaceSwitcher collapsed={false} organizationName={organizationName} />
              <ThemeToggle />
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
