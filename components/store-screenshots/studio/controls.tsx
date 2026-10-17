'use client'

import * as React from 'react'
import { Slider } from '@/components/ui/slider'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/**
 * Inspector primitives. Every property in the inspector uses these, so
 * labels, units, precision, keyboard stepping, and tooltips behave the same
 * everywhere and no control has a second, competing implementation.
 */

/** An icon button with an accessible name and a tooltip that shows its shortcut. */
export function IconButton({
  label,
  shortcut,
  children,
  className,
  active,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; shortcut?: string; active?: boolean }): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          aria-keyshortcuts={shortcut}
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.07] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/25 disabled:pointer-events-none disabled:opacity-40',
            active && 'bg-foreground/[0.1] text-foreground',
            className
          )}
          {...props}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label}
        {shortcut ? <span className="ml-2 opacity-60">{shortcut}</span> : null}
      </TooltipContent>
    </Tooltip>
  )
}

/** A titled inspector section. */
export function Section({
  title,
  actions,
  children,
  description,
}: {
  title: string
  actions?: React.ReactNode
  children: React.ReactNode
  description?: string
}): React.JSX.Element {
  const id = React.useId()
  return (
    <section aria-labelledby={id} className="space-y-3 border-b border-foreground/[0.07] px-4 py-4 last:border-b-0">
      <div className="flex min-h-6 items-center justify-between gap-2">
        <h3 id={id} className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          {title}
        </h3>
        {actions ? <div className="flex items-center gap-1">{actions}</div> : null}
      </div>
      {description ? <p className="-mt-1 text-[11px] leading-relaxed text-muted-foreground">{description}</p> : null}
      {children}
    </section>
  )
}

function format(value: number, precision: number): string {
  const rounded = Math.round(value * 10 ** precision) / 10 ** precision
  return Number.isFinite(rounded) ? String(rounded) : ''
}

/**
 * A labeled numeric input with a unit. Arrow keys step (Shift x10), Enter
 * commits, Escape reverts. While focused it keeps the user's draft; when the
 * value changes elsewhere (dragging on the canvas) it follows immediately.
 */
export function NumberField({
  label,
  value,
  unit,
  min,
  max,
  step = 1,
  precision = 0,
  onChange,
  hint,
  disabled,
  compact,
}: {
  label: string
  value: number
  unit?: string
  min: number
  max: number
  step?: number
  precision?: number
  onChange: (value: number) => void
  hint?: string
  disabled?: boolean
  compact?: boolean
}): React.JSX.Element {
  const id = React.useId()
  const [draft, setDraft] = React.useState<string | null>(null)
  const commit = (raw: string) => {
    const parsed = Number(raw)
    setDraft(null)
    if (!raw.trim() || !Number.isFinite(parsed)) return
    onChange(Math.min(max, Math.max(min, parsed)))
  }
  const input = (
    <div className={cn('flex h-8 min-w-0 items-center rounded-md border border-foreground/10 bg-foreground/[0.035] focus-within:border-foreground/30', disabled && 'opacity-50')}>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        disabled={disabled}
        aria-label={compact ? `${label}${unit ? ` (${unit})` : ''}` : undefined}
        aria-describedby={hint ? `${id}-hint` : undefined}
        value={draft ?? format(value, precision)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit(event.currentTarget.value)
          else if (event.key === 'Escape') {
            setDraft(null)
            event.currentTarget.blur()
          } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault()
            const delta = (event.key === 'ArrowUp' ? step : -step) * (event.shiftKey ? 10 : 1)
            const next = Math.min(max, Math.max(min, Number(format(value + delta, Math.max(precision, 3)))))
            setDraft(null)
            onChange(next)
          }
        }}
        className="h-full w-full min-w-0 bg-transparent px-2 text-xs tabular-nums text-foreground outline-none"
      />
      {unit ? <span className="pr-2 text-[10px] text-muted-foreground">{unit}</span> : null}
    </div>
  )
  if (compact) return input
  return (
    <div className="min-w-0 space-y-1">
      <label htmlFor={id} className="block text-[11px] text-muted-foreground">
        {label}
      </label>
      {input}
      {hint ? (
        <p id={`${id}-hint`} className="text-[10px] leading-snug text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

/** A slider paired with a numeric input; both edit the same value. */
export function SliderField({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  precision = 0,
  onChange,
  onCommit,
  hint,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  precision?: number
  onChange: (value: number) => void
  onCommit?: () => void
  hint?: string
}): React.JSX.Element {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">{label}</span>
        <div className="w-[84px]">
          <NumberField label={label} value={value} unit={unit} min={min} max={max} step={step} precision={precision} onChange={onChange} compact />
        </div>
      </div>
      <Slider
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={[Math.min(max, Math.max(min, value))]}
        onValueChange={([next]) => onChange(next)}
        onValueCommit={() => onCommit?.()}
      />
      {hint ? <p className="text-[10px] leading-snug text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

/** WCAG badge for a contrast ratio. */
export function ContrastBadge({ ratio, required }: { ratio: number; required: number }): React.JSX.Element {
  const pass = ratio >= required
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums',
        pass ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300' : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
      )}
      title={`Contrast ${ratio.toFixed(1)}:1; this text needs ${required}:1 to stay readable at store preview size.`}
    >
      {ratio.toFixed(1)}:1 {pass ? 'Readable' : 'Low contrast'}
    </span>
  )
}

/**
 * A color picker with an optional automatic mode. In automatic mode the
 * renderer chooses a readable color for the background behind the element.
 */
export function ColorField({
  label,
  value,
  resolved,
  palette = [],
  allowAuto = false,
  contrast,
  onChange,
}: {
  label: string
  /** Null means automatic. */
  value: string | null
  /** The color actually drawn (for automatic mode). */
  resolved?: string
  palette?: string[]
  allowAuto?: boolean
  contrast?: { ratio: number; required: number; readable?: string }
  onChange: (value: string | null) => void
}): React.JSX.Element {
  const id = React.useId()
  const shown = value ?? resolved ?? '#000000'
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-[11px] text-muted-foreground">
          {label}
        </label>
        {contrast ? <ContrastBadge ratio={contrast.ratio} required={contrast.required} /> : null}
      </div>
      <div className="flex items-center gap-1.5">
        <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-foreground/10 bg-foreground/[0.035] px-2">
          <input
            id={id}
            type="color"
            value={shown.toLowerCase()}
            onChange={(event) => onChange(event.target.value.toUpperCase())}
            className="size-5 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
          />
          <span className="truncate font-mono text-[11px] uppercase text-foreground">{value === null && allowAuto ? `Auto · ${shown}` : shown}</span>
        </div>
        {allowAuto ? (
          <button
            type="button"
            aria-pressed={value === null}
            onClick={() => onChange(value === null ? shown : null)}
            title="Automatic picks a readable color for the background behind this text"
            className={cn(
              'h-8 rounded-md border px-2 text-[11px]',
              value === null ? 'border-foreground/30 bg-foreground/[0.1] text-foreground' : 'border-foreground/10 text-muted-foreground hover:text-foreground'
            )}
          >
            Auto
          </button>
        ) : null}
      </div>
      {palette.length ? (
        <div className="flex flex-wrap gap-1" role="group" aria-label={`${label} palette`}>
          {palette.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={`Use ${color}`}
              title={color}
              onClick={() => onChange(color)}
              className={cn('size-5 rounded-full border border-foreground/15', value?.toUpperCase() === color.toUpperCase() && 'ring-2 ring-foreground/40 ring-offset-1 ring-offset-background')}
              style={{ background: color }}
            />
          ))}
        </div>
      ) : null}
      {contrast && contrast.ratio < contrast.required && contrast.readable ? (
        <button type="button" onClick={() => onChange(null)} className="text-[11px] font-medium text-foreground underline underline-offset-2">
          Use a readable color automatically
        </button>
      ) : null}
    </div>
  )
}

/** A labeled native select. */
export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  hideLabel,
}: {
  label: string
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
  hideLabel?: boolean
}): React.JSX.Element {
  const id = React.useId()
  return (
    <div className="min-w-0 space-y-1">
      <label htmlFor={id} className={cn('block text-[11px] text-muted-foreground', hideLabel && 'sr-only')}>
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="h-8 w-full rounded-md border border-foreground/10 bg-foreground/[0.035] px-2 text-xs text-foreground outline-none focus:border-foreground/30"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}

/** A row of toggle buttons for a small set of choices. */
export function ChoiceField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: Array<{ value: T; label: string; icon?: React.ReactNode }>
  onChange: (value: T) => void
}): React.JSX.Element {
  return (
    <div className="space-y-1">
      <span className="block text-[11px] text-muted-foreground">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex h-8 rounded-md border border-foreground/10 bg-foreground/[0.035] p-0.5">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            aria-label={option.icon ? option.label : undefined}
            title={option.label}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex min-w-0 flex-1 items-center justify-center rounded-[5px] px-1.5 text-[11px]',
              value === option.value ? 'bg-foreground/[0.12] text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {option.icon ?? option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/** A labeled switch row. */
export function ToggleField({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  hint?: string
}): React.JSX.Element {
  const id = React.useId()
  return (
    <div className="space-y-0.5">
      <label htmlFor={id} className="flex cursor-pointer items-center justify-between gap-3 text-[11px] text-muted-foreground">
        <span>{label}</span>
        <input id={id} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="size-4 accent-foreground" />
      </label>
      {hint ? <p className="text-[10px] leading-snug text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

/** Alignment icons. */
export const ALIGN_ICONS = {
  left: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M4 6h16M4 12h10M4 18h14" />
    </svg>
  ),
  center: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M4 6h16M7 12h10M5 18h14" />
    </svg>
  ),
  right: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M4 6h16M10 12h10M6 18h14" />
    </svg>
  ),
} as const
