import { cookies } from 'next/headers'
import type { ReactNode } from 'react'
import { OnboardingProgressCard } from '@/components/onboarding/OnboardingProgressCard'
import { PreferencesProvider } from '@/components/settings/PreferencesProvider'
import { contentDraftsEnabled } from '@/lib/content-drafts/flag'
import { NAVIGATION_COOKIE, parseNavigation } from '@/lib/settings/appearance'
import { cn } from '@/lib/utils'
import { PlatformSidebar } from './PlatformSidebar'
import { surface } from './shell-config'

export interface PlatformShellProps {
  /** Show Campaigns; the campaign workflow is behind a rollout flag. */
  campaignsEnabled?: boolean
  children: ReactNode
  organizationName?: string
  /**
   * `page` puts the page on a rounded panel inset from the sidebar.
   * `editor` sits flush beside the editor, which fills the viewport and
   * brings its own account menu and mobile chrome.
   */
  variant?: 'editor' | 'page'
}

/**
 * Signed-in app chrome: the navigation beside the page, laid out as the
 * person chose (RFC 043), with their preferences loaded for every page.
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
  const navigation = parseNavigation((await cookies()).get(NAVIGATION_COOKIE)?.value)
  return (
    <PreferencesProvider>
      <div
        // Pages show at 80% on wider screens (app/globals.css); the editors'
        // artboards stay at their real size.
        data-app-zoom={variant === 'page' ? '' : undefined}
        className={cn(
          'flex min-h-screen flex-col text-foreground md:flex-row',
          variant === 'editor' &&
            '[--editor-height:calc(100dvh-3.5rem)] md:[--editor-height:100dvh]',
          surface.base
        )}
      >
        <PlatformSidebar
          campaignsEnabled={campaignsEnabled}
          draftsEnabled={contentDraftsEnabled()}
          initialNavigation={navigation}
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
        <OnboardingProgressCard />
      </div>
    </PreferencesProvider>
  )
}
