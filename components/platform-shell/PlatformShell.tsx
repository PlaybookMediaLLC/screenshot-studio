import type { ReactNode } from 'react'
import { cookies } from 'next/headers'
import { PlatformSidebar } from './PlatformSidebar'
import { PLATFORM_SIDEBAR_COOKIE } from './sidebar-state'

export interface PlatformShellProps {
  /** Show Campaigns; the campaign workflow is behind a rollout flag. */
  campaignsEnabled?: boolean
  children: ReactNode
  organizationName?: string
  /** The editor header already has an account menu, so the editor hides this one. */
  showAccount?: boolean
  /** The editor has its own mobile chrome, so it skips the mobile top bar. */
  showMobileBar?: boolean
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
  showAccount = true,
  showMobileBar = true,
}: PlatformShellProps) {
  const collapsed = (await cookies()).get(PLATFORM_SIDEBAR_COOKIE)?.value === 'collapsed'
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground md:flex-row">
      <PlatformSidebar
        campaignsEnabled={campaignsEnabled}
        defaultCollapsed={collapsed}
        organizationName={organizationName}
        showAccount={showAccount}
        showMobileBar={showMobileBar}
      />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
