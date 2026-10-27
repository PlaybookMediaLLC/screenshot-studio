'use client'

import * as React from 'react'
import { DEVICE_MODELS, DEVICE_STYLE_LABELS, getDeviceModel } from '@/lib/store-screenshots/devices'
import { deviceStyleSchema, type DeviceStyle } from '@/lib/store-screenshots/document/schema'
import { LAYOUT_PRESETS } from '@/lib/store-screenshots/engine/presets'
import { resolveTextStyle } from '@/lib/store-screenshots/engine/text'
import { useStudioActions } from '../actions'
import { ColorField, Section, SelectField } from '../controls'
import { useEditor, useEditorApi } from '../editor-store'
import { BackgroundField } from './BackgroundField'
import { FontPicker } from './FontPicker'
import { WEIGHT_OPTIONS } from './TextPanel'
import { Button } from '@/components/ui/button'

/**
 * Bulk editing for several selected slides. Each control writes one
 * property group to exactly the selected slides as a single undo step;
 * everything else on those slides (copy, screenshots, positions) is kept.
 */
export function BulkPanel(): React.JSX.Element {
  const api = useEditorApi()
  const actions = useStudioActions()
  const selected = useEditor((state) => state.selectedSlideIds)
  const theme = useEditor((state) => state.document.theme)
  const firstSlide = useEditor((state) => state.document.slides.find((slide) => slide.id === state.selectedSlideIds[0]))
  const locale = useEditor((state) => state.locale)
  const count = selected.length
  const background = firstSlide?.background ?? theme.background
  const firstDevice = firstSlide?.layers.find((layer) => layer.type === 'device')
  const modelId = firstDevice?.frame.modelId ?? theme.deviceFrame.modelId
  const model = getDeviceModel(modelId)
  const heading = firstSlide?.layers.find((layer) => layer.type === 'text' && layer.role === 'heading')
  const subheading = firstSlide?.layers.find((layer) => layer.type === 'text' && layer.role === 'subheading')
  const headingStyle = heading?.type === 'text' ? resolveTextStyle(heading, theme, locale) : theme.textStyles.heading
  const subheadingStyle = subheading?.type === 'text' ? resolveTextStyle(subheading, theme, locale) : theme.textStyles.subheading

  return (
    <>
      <Section title={`${count} slides selected`} description="Controls show the first selected slide. Changes apply to every selected slide and undo as one step.">
        <Button variant="custom" size={null} type="button" onClick={() => actions.openDialog('applyStyle')} className="h-8 w-full rounded-md border border-foreground/10 text-[11px] hover:bg-foreground/[0.05]">
          Copy style from the active slide…
        </Button>
        <Button variant="custom" size={null} type="button" onClick={() => actions.openDialog('brandKits')} className="h-8 w-full rounded-md border border-foreground/10 text-[11px] hover:bg-foreground/[0.05]">
          Apply a brand kit…
        </Button>
      </Section>
      <Section title="Background">
        <BackgroundField
          value={background}
          palette={theme.palette}
          onChange={(next, asset) => {
            if (!next) {
              api.getState().dispatch({ type: 'slides.patch', slideIds: selected, patch: { background: null } })
              return
            }
            api.getState().dispatchMany(
              [...(asset ? [{ type: 'assets.add' as const, assets: [asset] }] : []), { type: 'slides.patch', slideIds: selected, patch: { background: next } }],
              `Background on ${count} slides`,
              { key: `bulk-background:${selected.join(',')}` }
            )
          }}
          allowInherit
        />
      </Section>
      <Section title="Layout">
        <SelectField
          label="Layout for selected slides"
          value=""
          options={[{ value: '', label: 'Choose a layout…' }, ...LAYOUT_PRESETS.map((preset) => ({ value: preset.id, label: preset.name }))]}
          onChange={(value) => {
            const preset = LAYOUT_PRESETS.find((item) => item.id === value)
            if (preset) api.getState().dispatch({ type: 'slides.setLayout', slideIds: selected, layout: preset.id })
          }}
        />
      </Section>
      <Section title="Text">
        <FontPicker
          label="Font for all text"
          value={headingStyle.fontFamily}
          onChange={(fontFamily) => api.getState().dispatch({ type: 'slides.patchText', slideIds: selected, roles: ['heading', 'subheading', 'body'], style: { fontFamily } })}
        />
        <SelectField
          label="Heading weight"
          value={String(headingStyle.fontWeight)}
          options={[{ value: '', label: 'Choose…' }, ...WEIGHT_OPTIONS]}
          onChange={(value) => value && api.getState().dispatch({ type: 'slides.patchText', slideIds: selected, roles: ['heading'], style: { fontWeight: Number(value) } })}
        />
        <ColorField
          label="Heading color"
          value={headingStyle.color}
          allowAuto
          resolved="#111111"
          palette={theme.palette}
          onChange={(color) => api.getState().dispatch({ type: 'slides.patchText', slideIds: selected, roles: ['heading'], style: { color } }, { key: `bulk-heading-color:${selected.join(',')}` })}
        />
        <ColorField
          label="Subheading color"
          value={subheadingStyle.color}
          allowAuto
          resolved="#3F3F46"
          palette={theme.palette}
          onChange={(color) => api.getState().dispatch({ type: 'slides.patchText', slideIds: selected, roles: ['subheading', 'body'], style: { color } }, { key: `bulk-sub-color:${selected.join(',')}` })}
        />
      </Section>
      <Section title="Devices">
        <SelectField
          label="Model"
          value={modelId}
          options={DEVICE_MODELS.map((item) => ({ value: item.id, label: item.name }))}
          onChange={(value) => {
            api.getState().dispatch({ type: 'slides.patchDevices', slideIds: selected, frame: { modelId: value, finishId: getDeviceModel(value).finishes[0].id } })
          }}
        />
        <SelectField
          label="Finish"
          value={firstDevice?.frame.finishId ?? theme.deviceFrame.finishId}
          options={[{ value: '', label: 'Choose…' }, ...model.finishes.map((finish) => ({ value: finish.id, label: finish.name }))]}
          onChange={(finishId) => finishId && api.getState().dispatch({ type: 'slides.patchDevices', slideIds: selected, frame: { modelId, finishId } })}
        />
        <SelectField<DeviceStyle | ''>
          label="Style"
          value={firstDevice?.frame.style ?? theme.deviceFrame.style}
          options={[{ value: '', label: 'Choose…' }, ...deviceStyleSchema.options.map((style) => ({ value: style, label: DEVICE_STYLE_LABELS[style] }))]}
          onChange={(style) => style && api.getState().dispatch({ type: 'slides.patchDevices', slideIds: selected, frame: { style } })}
        />
        <Button variant="custom" size={null}
          type="button"
          onClick={() => api.getState().dispatch({ type: 'slides.patchDevices', slideIds: selected, transform: { offsetX: 0, offsetY: 0, scale: 1, rotation: 0, tiltX: 0, tiltY: 0 } })}
          className="h-8 w-full rounded-md border border-foreground/10 text-[11px] hover:bg-foreground/[0.05]"
        >
          Reset device positions on {count} slides
        </Button>
      </Section>
    </>
  )
}
