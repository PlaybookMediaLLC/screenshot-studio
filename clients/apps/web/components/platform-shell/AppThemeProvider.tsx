'use client'

import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { ThemeProvider } from 'next-themes'
import { followsTheme, THEME_STORAGE_KEY } from '@/lib/settings/appearance'

/**
 * The app's theme. next-themes sets the `<html>` class before the first paint,
 * so a page never flashes the wrong theme or mismatches on hydration. Pages
 * outside the platform keep the dark design they were built for.
 */
export function AppThemeProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      disableTransitionOnChange
      enableSystem
      forcedTheme={followsTheme(pathname ?? '/') ? undefined : 'dark'}
      storageKey={THEME_STORAGE_KEY}
    >
      {children}
    </ThemeProvider>
  )
}
