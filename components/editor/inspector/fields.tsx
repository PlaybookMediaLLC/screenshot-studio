'use client'

import * as React from 'react'
import { ColorPicker } from '@/components/ui/color-picker'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Switch } from '@/components/ui/switch'

/**
 * Inspector fields shared by every property panel, so a colour, a toggle,
 * or a choice looks and behaves the same wherever it appears. Sliders use
 * the editor's Slider, which already takes a label and value display.
 */

/** A labelled colour swatch that opens the colour picker. */
export function ColorField({ label, onChange, value }: { label: string; onChange: (color: string) => void; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <ColorPicker color={value} onChange={onChange} />
    </div>
  )
}

/** A labelled on/off switch. */
export function ToggleField({
  checked,
  label,
  onChange,
}: {
  checked: boolean
  label: string
  onChange: (checked: boolean) => void
}) {
  const id = React.useId()
  return (
    <div className="flex items-center justify-between gap-2">
      <label className="text-xs text-muted-foreground" htmlFor={id}>
        {label}
      </label>
      <Switch checked={checked} id={id} onCheckedChange={onChange} />
    </div>
  )
}

/** A labelled choice between a few named options. */
export function ChoiceField<Value extends string>({
  label,
  onChange,
  options,
  value,
}: {
  label: string
  onChange: (value: Value) => void
  options: readonly { label: string; value: Value }[]
  value: Value
}) {
  return (
    <div className="space-y-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <SegmentedControl
        ariaLabel={label}
        onChange={(next) => onChange(next as Value)}
        options={options.map((option) => ({ ariaLabel: option.label, id: option.value, label: option.label }))}
        size="sm"
        value={value}
      />
    </div>
  )
}
