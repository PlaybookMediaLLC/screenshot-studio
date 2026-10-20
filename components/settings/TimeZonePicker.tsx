'use client'

import { useId, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/** Every IANA zone this browser knows, with UTC always first. */
function allZones(): string[] {
  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []
  return ['UTC', ...zones.filter((zone) => zone !== 'UTC')]
}

/** A zone's current UTC offset, such as `UTC−04:00`. */
export function utcOffset(zone: string, at = new Date()): string {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
      .formatToParts(at)
      .find((item) => item.type === 'timeZoneName')?.value
    return part === 'GMT' || !part ? 'UTC+00:00' : part.replace('GMT', 'UTC').replace('-', '−')
  } catch {
    return ''
  }
}

/** A zone as people read it: `New York · America/New_York · UTC−04:00`. */
export function zoneLabel(zone: string): string {
  const city = zone.split('/').at(-1)?.replaceAll('_', ' ') ?? zone
  return `${city} · ${zone} · ${utcOffset(zone)}`
}

/** The browser's own zone. */
export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

/**
 * Picks an IANA time zone: search by region or city, see each zone's UTC
 * offset, detect the browser's zone, and preview what a time reads as.
 */
export function TimeZonePicker({
  allowBrowser,
  disabled,
  label,
  onChange,
  value,
}: {
  /** Offer "follow my browser", saved as no zone. */
  allowBrowser?: boolean
  disabled?: boolean
  label: string
  onChange: (zone: string) => void
  value: string | null
}) {
  const id = useId()
  const [query, setQuery] = useState('')
  const zones = useMemo(() => allZones(), [])
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase().replaceAll(' ', '_')
    const found = needle ? zones.filter((zone) => zone.toLowerCase().includes(needle)) : zones
    return value && !found.includes(value) ? [value, ...found] : found
  }, [query, value, zones])
  const effective = value ?? browserTimeZone()
  const preview = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: effective,
  }).format(new Date())

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid min-w-48 flex-1 gap-1 text-sm" htmlFor={`${id}-search`}>
          <span className="text-xs text-muted-foreground">Search {label.toLowerCase()}</span>
          <Input
            disabled={disabled}
            id={`${id}-search`}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="City or region, such as Paris"
            value={query}
          />
        </label>
        <Button
          disabled={disabled}
          onClick={() => {
            setQuery('')
            onChange(browserTimeZone())
          }}
          type="button"
          variant="outline"
        >
          Detect
        </Button>
      </div>
      <label className="grid gap-1 text-sm" htmlFor={`${id}-zone`}>
        <span className="font-medium text-foreground">{label}</span>
        <select
          className="h-9 rounded-lg border border-border bg-card px-2 text-sm text-foreground disabled:opacity-60"
          disabled={disabled}
          id={`${id}-zone`}
          onChange={(event) => onChange(event.target.value)}
          value={value ?? ''}
        >
          {allowBrowser ? <option value="">Follow my browser ({zoneLabel(browserTimeZone())})</option> : null}
          {matches.map((zone) => (
            <option key={zone} value={zone}>
              {zoneLabel(zone)}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs text-muted-foreground">
        Now: {preview} ({utcOffset(effective)})
      </p>
    </div>
  )
}
