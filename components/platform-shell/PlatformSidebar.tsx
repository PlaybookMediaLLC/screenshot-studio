'use client'

import {
  Activity01Icon,
  ArrowDown01Icon,
  Album02Icon,
  Folder01Icon,
  Link01Icon,
  Megaphone01Icon,
  Menu01Icon,
  NoteEditIcon,
  PaintBoardIcon,
  SlidersHorizontalIcon,
  UnfoldMoreIcon,
} from 'hugeicons-react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { type ComponentType, useState } from 'react'
import { AccountMenu } from '@/components/auth/AccountMenu'
import { Collapsible } from 'radix-ui'
import {
  Building2,
  UserRound,
  Users,
  ShieldCheck,
  CreditCard,
  LockKeyhole,
  KeyRound,
  ScrollText,
  Palette,
  Plug,
  Bot,
  Link2,
  Package,
  PanelsTopLeft,
  Share2,
  Code2,
} from 'lucide-react'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useHydratedSession } from '@/lib/auth/client'
import { cn } from '@/lib/utils'
import {
  SETTINGS_SECTIONS,
  settingsHref,
  type SettingId,
} from '@/components/workspace/settings-sections'
import { workspaceInitials } from '@/lib/workspace/initials'
import { surface } from './shell-config'
import { Button } from '@/components/ui/button'
import { EditorNavigation } from './EditorNavigation'

type IconComponent = ComponentType<{ className?: string; size?: number; strokeWidth?: number }>
type SubItem = { href: string; icon: IconComponent; label: string }
type NavItem = { children?: SubItem[]; href: string; icon: IconComponent; label: string }

const SETTINGS_ICONS: Record<SettingId, IconComponent> = {
  general: Building2,
  profile: UserRound,
  members: Users,
  roles: ShieldCheck,
  billing: CreditCard,
  security: LockKeyhole,
  sso: KeyRound,
  audit: ScrollText,
  brand: Palette,
  integrations: Plug,
  'release-automation': Bot,
  agents: Bot,
  sharing: Link2,
  product: Package,
  surfaces: PanelsTopLeft,
  channels: Share2,
  api: Code2,
}

const NAV_GROUPS: { items: NavItem[]; label?: string }[] = [
  {
    items: [
      { href: '/', icon: PaintBoardIcon, label: 'Editor' },
      { href: '/projects', icon: Folder01Icon, label: 'Projects' },
      { href: '/creative-sets', icon: Album02Icon, label: 'Story Sets' },
      { href: '/campaigns', icon: Megaphone01Icon, label: 'Campaigns' },
      { href: '/drafts', icon: NoteEditIcon, label: 'Drafts' },
      { href: '/assets', icon: Album02Icon, label: 'Assets' },
      { href: '/link-preview', icon: Link01Icon, label: 'Link preview' },
    ],
  },
  {
    items: [
      { href: '/activity', icon: Activity01Icon, label: 'Activity' },
      {
        children: SETTINGS_SECTIONS.map((section) => ({
          href: settingsHref(section),
          icon: SETTINGS_ICONS[section.id],
          label: section.title,
        })),
        href: '/workspace',
        icon: SlidersHorizontalIcon,
        label: 'Settings',
      },
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

/** Section links expand inside the rail or underneath the labeled mobile row. */
function SubNav({
  collapsed,
  items,
  label,
  onNavigate,
}: {
  collapsed: boolean
  items: SubItem[]
  label: string
  onNavigate?: () => void
}) {
  const path = routePath(usePathname())
  return (
    <nav
      aria-label={`Workspace ${label.toLowerCase()}`}
      className={
        collapsed
          ? 'mt-1 grid gap-0.5 border-y border-white/[0.06] py-1'
          : 'my-1.5 ml-[17px] flex flex-col gap-0.5 border-l border-white/[0.08] pl-3'
      }
    >
      {items.map(({ href, label: itemLabel, icon: Icon }) => {
        const active = path === href
        const link = (
          <Link
            href={href}
            aria-current={active ? 'page' : undefined}
            aria-label={collapsed ? itemLabel : undefined}
            className={cn(
              'rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              collapsed
                ? cn(
                    'grid size-8 place-items-center rounded-lg border',
                    active
                      ? cn(surface.panel, surface.border, 'text-white shadow-xs')
                      : 'border-transparent text-neutral-500 hover:text-neutral-200'
                  )
                : cn('block py-1', active ? 'text-white' : 'text-[#858585] hover:text-neutral-200')
            )}
            onClick={onNavigate}
          >
            {collapsed ? <Icon className="shrink-0" size={14} strokeWidth={1.8} /> : itemLabel}
          </Link>
        )
        return collapsed ? (
          <Tooltip key={href}>
            <TooltipTrigger asChild>{link}</TooltipTrigger>
            <TooltipContent side="right">{itemLabel}</TooltipContent>
          </Tooltip>
        ) : (
          <div key={href}>{link}</div>
        )
      })}
    </nav>
  )
}

function NavLink({
  collapsed,
  item: { children, href, icon: Icon, label },
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
      ? cn(surface.panel, surface.border, 'text-white shadow-xs')
      : 'border-transparent text-[#858585] hover:text-neutral-200',
    collapsed && 'size-8 justify-center px-0'
  )
  if (children) {
    const trigger = (
      <Collapsible.Trigger asChild>
        <Button variant="custom" size={null}
          type="button"
          aria-label={label}
          data-keep-selection
          className={cn(rowClassName, 'group cursor-pointer', !collapsed && 'w-full')}
        >
          <Icon className="shrink-0" size={16} strokeWidth={1.8} />
          {collapsed ? null : (
            <>
              <span className="truncate">{label}</span>
              <ArrowDown01Icon
                className="ml-auto shrink-0 transition-transform group-data-[state=closed]:-rotate-90"
                size={14}
              />
            </>
          )}
        </Button>
      </Collapsible.Trigger>
    )
    return (
      <Collapsible.Root defaultOpen={active} key={pathname}>
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>{trigger}</TooltipTrigger>
            <TooltipContent side="right">{label}</TooltipContent>
          </Tooltip>
        ) : (
          trigger
        )}
        <Collapsible.Content>
          <SubNav collapsed={collapsed} items={children} label={label} onNavigate={onNavigate} />
        </Collapsible.Content>
      </Collapsible.Root>
    )
  }
  const link = (
    <Link
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? label : undefined}
      className={rowClassName}
      href={href}
      onClick={onNavigate}
    >
      <Icon className="shrink-0" size={16} strokeWidth={1.8} />
      {collapsed ? null : <span className="truncate">{label}</span>}
    </Link>
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
      {NAV_GROUPS.map((group, index) => (
        <div className="grid gap-0.5" key={index}>
          {group.label && !collapsed ? (
            <p className="mb-1.5 px-2 text-xs font-medium text-neutral-600">{group.label}</p>
          ) : null}
          {group.items
            .filter((item) => campaignsEnabled || item.href !== '/campaigns')
            .filter((item) => draftsEnabled || item.href !== '/drafts')
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
          Shots
        </span>
      )}
    </Link>
  )
}

export interface PlatformSidebarProps {
  campaignsEnabled: boolean
  /** Show Drafts; content drafts are behind PLATFORM_CONTENT_DRAFTS. */
  draftsEnabled?: boolean
  organizationName?: string
  variant: 'editor' | 'page'
}

/**
 * Desktop: section icons expand inside the fixed rail, with labels in tooltips.
 * Mobile: a full drawer with collapsible section links.
 */
export function PlatformSidebar({
  campaignsEnabled,
  draftsEnabled = false,
  organizationName = 'Workspace',
  variant,
}: PlatformSidebarProps) {
  // The editor header already holds its account menu.
  const isPage = variant === 'page'
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <>
      <aside
        className={cn(
          'sticky top-0 hidden h-screen w-14 shrink-0 flex-col items-center border-r border-white/[0.04] py-3 md:flex',
          surface.base
        )}
      >
        <Brand collapsed />

        <div className="mt-5 min-h-0 flex-1 overflow-y-auto px-1 [scrollbar-width:none]">
          <Navigation campaignsEnabled={campaignsEnabled} collapsed draftsEnabled={draftsEnabled} />
        </div>

        {isPage ? (
          // In development, room for the Next.js dev badge, which otherwise
          // sits on the switcher and swallows clicks.
          <div
            className={cn(
              'flex w-full justify-center border-t border-white/[0.06] pt-2',
              process.env.NODE_ENV === 'development' && 'mb-12'
            )}
          >
            <WorkspaceSwitcher collapsed organizationName={organizationName} />
          </div>
        ) : null}
      </aside>

      <header
        className={cn(
          'sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-white/[0.06] px-4 md:hidden',
          surface.base
        )}
      >
        <Sheet onOpenChange={setMobileOpen} open={mobileOpen}>
          <SheetTrigger asChild>
            <Button variant="custom" size={null}
              aria-label="Open navigation"
              className="grid size-9 place-items-center rounded-lg text-neutral-400 hover:bg-white/[0.04] hover:text-neutral-100"
              type="button"
            >
              <Menu01Icon size={18} strokeWidth={1.8} />
            </Button>
          </SheetTrigger>
          <SheetContent
            className={cn('w-72 gap-0 border-white/[0.06] p-3', surface.base)}
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
    </>
  )
}
