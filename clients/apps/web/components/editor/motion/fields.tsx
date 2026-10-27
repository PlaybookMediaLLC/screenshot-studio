'use client'

import { toast } from 'sonner'
import * as React from 'react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'

/**
 * Number inputs for motion: values in the units the panel shows, times in
 * seconds. Edits apply as the user types; an empty or partial entry waits
 * until it reads as a number.
 */

const inputClass =
  'h-7 w-full rounded-md border border-foreground/10 bg-background px-2 text-xs tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40'

/** A labelled number input. */
export function NumberField({
  label,
  max,
  min,
  onChange,
  step = 1,
  suffix,
  value,
}: {
  label: string
  max?: number
  min?: number
  onChange: (value: number) => void
  step?: number
  suffix?: string
  value: number
}) {
  const id = React.useId()
  return (
    <div className="flex items-center justify-between gap-2">
      <Label className="shrink-0 text-xs text-muted-foreground" htmlFor={id}>
        {label}
      </Label>
      <div className="flex w-24 items-center gap-1">
        <Input
          className={inputClass}
          id={id}
          max={max}
          min={min}
          onChange={(event) => {
            const number = Number(event.target.value)
            if (event.target.value.trim() === '' || !Number.isFinite(number)) return
            const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, number))
            if (clamped !== number) toast.error(`${label} must be ${min ?? '−∞'} to ${max ?? '∞'}${suffix ?? ''}. Kept within that range.`)
            onChange(clamped)
          }}
          step={step}
          type="number"
          value={value}
        />
        {suffix ? <span className="w-3 text-[10px] text-muted-foreground">{suffix}</span> : null}
      </div>
    </div>
  )
}

/** A time in seconds, stored in milliseconds. */
export function SecondsField({
  label,
  max = 600,
  min = 0,
  onChange,
  valueMs,
}: {
  label: string
  max?: number
  min?: number
  onChange: (ms: number) => void
  valueMs: number
}) {
  return (
    <NumberField
      label={label}
      max={max}
      min={min}
      onChange={(seconds) => onChange(Math.round(seconds * 1000))}
      step={0.05}
      suffix="s"
      value={Math.round(valueMs) / 1000}
    />
  )
}

/** Milliseconds as a short time, like 1.25s. */
export function formatSeconds(ms: number): string {
  return `${(Math.round(ms / 10) / 100).toFixed(2)}s`
}
