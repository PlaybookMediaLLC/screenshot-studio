'use client'

import * as React from 'react'
import { Slider } from '@/components/ui/slider'
import { type TextOverlay, useImageStore } from '@/lib/store'
import { textAlignSchema, textFitSchema } from '@/lib/typography/text-style'
import { ChoiceField, ColorField, ToggleField } from '../inspector/fields'

/** Gradient fill, alignment, text box and fit, and spacing for one text layer. */
export function TextStyleFields({ text }: { text: TextOverlay }) {
  const update = (changes: Partial<TextOverlay>) => useImageStore.getState().updateTextOverlay(text.id, changes)
  const gradient = text.fill?.kind === 'gradient' ? text.fill : null
  return (
    <div className="space-y-3">
      <ToggleField
        checked={Boolean(gradient)}
        label="Gradient fill"
        onChange={(on) =>
          update({ fill: on ? { angle: 90, from: text.color, kind: 'gradient', to: '#7c3aed' } : { kind: 'solid' } })
        }
      />
      {gradient ? (
        <>
          <ColorField label="From" onChange={(from) => update({ fill: { ...gradient, from } })} value={gradient.from} />
          <ColorField label="To" onChange={(to) => update({ fill: { ...gradient, to } })} value={gradient.to} />
          <Slider
            label="Angle"
            max={360}
            min={0}
            onValueChange={([angle]) => update({ fill: { ...gradient, angle } })}
            step={1}
            value={[gradient.angle]}
            valueDisplay={`${gradient.angle}°`}
          />
        </>
      ) : null}
      <ChoiceField
        label="Align"
        onChange={(align) => update({ align })}
        options={textAlignSchema.options.map((value) => ({ label: value.charAt(0).toUpperCase() + value.slice(1), value }))}
        value={text.align ?? 'center'}
      />
      <ChoiceField
        label="Text box"
        onChange={(fit) => update({ fit, maxWidth: fit === 'none' ? undefined : (text.maxWidth ?? 0.8) })}
        options={[
          { label: 'Free', value: textFitSchema.enum.none },
          { label: 'Shrink to fit', value: textFitSchema.enum.shrink },
          { label: 'Wrap', value: textFitSchema.enum.wrap },
        ]}
        value={text.fit ?? 'none'}
      />
      {text.fit && text.fit !== 'none' ? (
        <Slider
          label="Box width"
          max={1}
          min={0.1}
          onValueChange={([maxWidth]) => update({ maxWidth })}
          step={0.01}
          value={[text.maxWidth ?? 0.8]}
          valueDisplay={`${Math.round((text.maxWidth ?? 0.8) * 100)}%`}
        />
      ) : null}
      <Slider
        label="Letter spacing"
        max={0.5}
        min={-0.1}
        onValueChange={([letterSpacing]) => update({ letterSpacing })}
        step={0.005}
        value={[text.letterSpacing ?? 0]}
        valueDisplay={`${(text.letterSpacing ?? 0).toFixed(3)}em`}
      />
      <Slider
        label="Line height"
        max={2.5}
        min={0.8}
        onValueChange={([lineHeight]) => update({ lineHeight })}
        step={0.05}
        value={[text.lineHeight ?? 1.2]}
        valueDisplay={(text.lineHeight ?? 1.2).toFixed(2)}
      />
    </div>
  )
}
