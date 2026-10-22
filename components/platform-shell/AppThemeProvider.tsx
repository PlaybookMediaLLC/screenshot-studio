'use client'

import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { ThemeProvider } from 'next-themes'
import { useHydratedSession } from '@/lib/auth/client'
import { followsTheme, withoutLocale, THEME_STORAGE_KEY } from '@/lib/settings/appearance'

/**
 * The app's theme. next-themes sets the `<html>` class before the first paint,
 * so a page never flashes the wrong theme or mismatches on hydration. Pages
 * outside the platform keep the dark design they were built for.
 */
export function AppThemeProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const { data: session } = useHydratedSession()
  const themed =
    followsTheme(pathname ?? '/') || (withoutLocale(pathname ?? '/') === '/' && !!session)
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      disableTransitionOnChange
      enableSystem
      forcedTheme={themed ? undefined : 'dark'}
      storageKey={THEME_STORAGE_KEY}
    >
      {children}
    </ThemeProvider>
  )
}
