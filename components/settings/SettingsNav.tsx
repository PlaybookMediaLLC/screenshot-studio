'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  SETTING_GROUPS,
  SETTINGS_SECTIONS,
  type SettingId,
  settingsHref,
} from '@/components/workspace/settings-sections'
import { withoutLocale } from '@/lib/settings/appearance'
import { cn } from '@/lib/utils'

function activeSection(pathname: string): SettingId | undefined {
  const path = withoutLocale(pathname)
  return [...SETTINGS_SECTIONS]
    .sort((a, b) => b.slug.length - a.slug.length)
    .find((section) => {
      const href = settingsHref(section)
      return section.slug === '' ? path === '/workspace' : path === href || path.startsWith(`${href}/`)
    })?.id
}

/**
 * The settings sections grouped by owner: personal, workspace, and publishing
 * identities. A list beside the section on wide screens, a menu above it on
 * narrow ones. Every entry is a link, so back, forward and deep links work.
 */
export function SettingsNav() {
  const pathname = usePathname()
  const router = useRouter()
  const current = activeSection(pathname ?? '/workspace')
  return (
    <>
      <label className="grid gap-1.5 lg:hidden">
        <span className="text-xs font-medium text-muted-foreground">Settings section</span>
        <select
          className="h-9 rounded-lg border border-border bg-card px-2 text-sm text-foreground"
          onChange={(event) => router.push(event.target.value)}
          value={(() => {
            const section = SETTINGS_SECTIONS.find((item) => item.id === current)
            return section ? settingsHref(section) : ''
          })()}
        >
          {SETTING_GROUPS.map((group) => (
            <optgroup key={group.id} label={group.title}>
              {SETTINGS_SECTIONS.filter((section) => section.group === group.id).map((section) => (
                <option key={section.id} value={settingsHref(section)}>
                  {section.title}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <nav aria-label="Settings" className="hidden w-52 shrink-0 lg:block">
        <div className="sticky top-6 grid gap-5">
          {SETTING_GROUPS.map((group) => (
            <div className="grid gap-0.5" key={group.id}>
              <p className="mb-1 px-2 text-xs font-medium text-muted-foreground">{group.title}</p>
              {SETTINGS_SECTIONS.filter((section) => section.group === group.id).map((section) => (
                <Link
                  aria-current={section.id === current ? 'page' : undefined}
                  className={cn(
                    'rounded-md px-2 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    section.id === current
                      ? 'bg-foreground/[0.06] font-medium text-foreground'
                      : 'text-muted-foreground hover:bg-foreground/[0.03] hover:text-foreground'
                  )}
                  href={settingsHref(section)}
                  key={section.id}
                >
                  {section.title}
                </Link>
              ))}
            </div>
          ))}
        </div>
      </nav>
    </>
  )
}
