'use client'

import {
  Activity01Icon,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useHydratedSession } from '@/lib/auth/client'
import { cn } from '@/lib/utils'
import { SETTINGS_SECTIONS, settingsHref } from '@/components/workspace/settings-sections'
import { workspaceInitials } from '@/lib/workspace/initials'
import { surface } from './shell-config'
import { Button } from '@/components/ui/button'

type IconComponent = ComponentType<{ className?: string; size?: number; strokeWidth?: number }>
type SubItem = { href: string; label: string }
type NavItem = { children?: SubItem[]; href: string; icon: IconComponent; label: string }

const NAV_GROUPS: { items: NavItem[]; label?: string }[] = [
  {
    items: [
      { href: '/', icon: PaintBoardIcon, label: 'Editor' },
      { href: '/projects', icon: Folder01Icon, label: 'Projects' },
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

/** Polar-style sub-links under the current section, on a hairline rail. */
function SubNav({
  items,
  label,
  onNavigate,
}: {
  items: SubItem[]
  label: string
  onNavigate?: () => void
}) {
  const path = routePath(usePathname())
  return (
    <nav
      aria-label={`Workspace ${label.toLowerCase()}`}
      className="my-1.5 ml-[17px] flex flex-col gap-0.5 border-l border-white/[0.08] pl-3"
    >
      {items.map((item) => {
        const active = path === item.href
        return (
          <Link
            aria-current={active ? 'page' : undefined}
            className={cn(
              'rounded-md py-1 text-sm font-medium transition-colors',
              active ? 'text-white' : 'text-neutral-500 hover:text-neutral-200'
            )}
            href={item.href}
            key={item.href}
            onClick={onNavigate}
          >
            {item.label}
          </Link>
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
  if (!collapsed) {
    return active && children ? (
      <div>
        {link}
        <SubNav items={children} label={label} onNavigate={onNavigate} />
      </div>
    ) : (
      link
    )
  }
  if (children) {
    // The rail has no room for sub-links, so they open beside it.
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="custom" size={null}
            aria-label={label}
            className={cn(
              'grid size-8 cursor-pointer place-items-center rounded-lg border transition-colors',
              active
                ? cn(surface.panel, surface.border, 'text-white shadow-xs')
                : 'border-transparent text-neutral-500 hover:text-neutral-200 data-[state=open]:text-neutral-200'
            )}
            type="button"
          >
            <Icon className="shrink-0" size={16} strokeWidth={1.8} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52" side="right" sideOffset={10}>
          <DropdownMenuLabel className="text-xs text-muted-foreground">{label}</DropdownMenuLabel>
          {children.map((child) => (
            <DropdownMenuItem asChild key={child.href}>
              <Link href={child.href} onClick={onNavigate}>
                {child.label}
              </Link>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }
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
 * Desktop: a fixed icon rail that never expands; labels show as tooltips and
 * Settings opens its sections beside the rail. Mobile: a full drawer.
 */
export function PlatformSidebar({
  campaignsEnabled,
  draftsEnabled = false,
  organizationName = 'Workspace',
  variant,
}: PlatformSidebarProps) {
  // The editor header holds the account menu and the mobile chrome.
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

        <div className="mt-5 flex-1">
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

      {isPage ? (
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
              <div className="mt-6 flex-1">
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
      ) : null}
    </>
  )
}
