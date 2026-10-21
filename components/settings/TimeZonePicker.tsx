'use client'

import { useId, useMemo, useState, useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

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

const subscribeNever = () => () => {}

/** The Select's stand-in for "follow my browser", which saves as no zone. */
const FOLLOW_BROWSER = '__browser__'

/**
 * True in the browser after hydration. The zone list, the browser's zone and
 * the clock differ between server and browser, so they render only then.
 */
function useInBrowser(): boolean {
  return useSyncExternalStore(subscribeNever, () => true, () => false)
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
  const inBrowser = useInBrowser()
  const zones = useMemo(() => (inBrowser ? allZones() : []), [inBrowser])
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase().replaceAll(' ', '_')
    const found = needle ? zones.filter((zone) => zone.toLowerCase().includes(needle)) : zones
    return value && !found.includes(value) ? [value, ...found] : found
  }, [query, value, zones])
  const browser = inBrowser ? browserTimeZone() : null
  const effective = value ?? browser
  const preview =
    effective &&
    new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: effective }).format(
      new Date()
    )

  return (
    <div className="grid w-full min-w-0 gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid min-w-0 flex-1 basis-48 gap-1 text-sm" htmlFor={`${id}-search`}>
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
      <div className="grid gap-1 text-sm">
        <label className="font-medium text-foreground" htmlFor={`${id}-zone`}>
          {label}
        </label>
        <Select
          disabled={disabled}
          onValueChange={(zone) => onChange(zone === FOLLOW_BROWSER ? '' : zone)}
          value={value ?? (allowBrowser ? FOLLOW_BROWSER : '')}
        >
          <SelectTrigger className="w-full min-w-0 bg-card text-foreground" id={`${id}-zone`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {allowBrowser ? (
              <SelectItem value={FOLLOW_BROWSER}>{browser ? `Follow my browser (${zoneLabel(browser)})` : 'Follow my browser'}</SelectItem>
            ) : null}
            {matches.map((zone) => (
              <SelectItem key={zone} value={zone}>
                {zoneLabel(zone)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <p className="text-xs text-muted-foreground">
        {preview && effective ? `Now: ${preview} (${utcOffset(effective)})` : '\u00a0'}
      </p>
    </div>
  )
}
