import type { ReactNode } from 'react'
import { cookies } from 'next/headers'
import { cn } from '@/lib/utils'
import { PlatformSidebar } from './PlatformSidebar'
import { PLATFORM_SIDEBAR_COOKIE, surface } from './shell-config'

export interface PlatformShellProps {
  /** Show Campaigns; the campaign workflow is behind a rollout flag. */
  campaignsEnabled?: boolean
  children: ReactNode
  organizationName?: string
  /**
   * `page` puts the page on a rounded panel inset from the sidebar.
   * `editor` sits flush beside the editor, which fills the viewport and
   * brings its own logo, account menu, and mobile chrome.
   */
  variant?: 'editor' | 'page'
}

/**
 * Signed-in app chrome: a collapsible sidebar beside the page.
 *
 * Fork-owned on purpose. Pages wrap themselves in it, so upstream editor
 * files and the upstream shadcn sidebar (whose cookie and ⌘B shortcut the
 * editor already uses) stay untouched.
 */
export async function PlatformShell({
  campaignsEnabled = false,
  children,
  organizationName,
  variant = 'page',
}: PlatformShellProps) {
  const collapsed = (await cookies()).get(PLATFORM_SIDEBAR_COOKIE)?.value === 'collapsed'
  return (
    <div className={cn('flex min-h-screen flex-col text-foreground md:flex-row', surface.base)}>
      <PlatformSidebar
        campaignsEnabled={campaignsEnabled}
        defaultCollapsed={collapsed}
        organizationName={organizationName}
        variant={variant}
      />
      {variant === 'page' ? (
        <div className="min-w-0 flex-1 md:py-2 md:pr-2">
          <div
            className={cn(
              'min-h-full md:min-h-[calc(100vh-1rem)] md:rounded-2xl md:border md:shadow-xs',
              surface.panel,
              surface.border
            )}
          >
            {children}
          </div>
        </div>
      ) : (
        <div className="min-w-0 flex-1 bg-background">{children}</div>
      )}
    </div>
  )
}
