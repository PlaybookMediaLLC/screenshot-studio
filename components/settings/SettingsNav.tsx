'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { usePathname } from 'next/navigation'
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
      return section.slug === ''
        ? path === '/workspace'
        : path === href || path.startsWith(`${href}/`)
    })?.id
}

/** Searchable settings destinations grouped by task, with links at every screen size. */
export function SettingsNav() {
  const pathname = usePathname()
  const [query, setQuery] = useState('')
  const current = activeSection(pathname ?? '/workspace')
  const sections = SETTINGS_SECTIONS.filter(
    (section) =>
      section.id !== 'new-team' &&
      `${section.title} ${section.description}`.toLowerCase().includes(query.trim().toLowerCase())
  )
  return (
    <nav aria-label="Settings" className="w-full shrink-0 lg:w-56">
      <div className="grid gap-5 lg:sticky lg:top-6">
        <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
          Search settings
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name or topic"
          />
        </label>
        {sections.length === 0 ? (
          <p className="text-sm text-muted-foreground" role="status">
            No settings match your search.
          </p>
        ) : null}
        <div className="grid max-h-64 gap-5 overflow-y-auto lg:max-h-[calc(100vh-12rem)]">
          {SETTING_GROUPS.map((group) => {
            const matches = sections.filter((section) => section.group === group.id)
            return matches.length ? (
              <div className="grid gap-0.5" key={group.id}>
                <p className="mb-1 px-2 text-xs font-medium text-muted-foreground">{group.title}</p>
                {matches.map((section) => (
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
            ) : null
          })}
        </div>
      </div>
    </nav>
  )
}
