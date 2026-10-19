'use client'

import * as React from 'react'
import { DEVICE_MODELS, DEVICE_STYLE_LABELS, getDeviceModel } from '@/lib/store-screenshots/devices'
import { deviceStyleSchema, type DeviceStyle, type Background } from '@/lib/store-screenshots/document/schema'
import { LAYOUT_PRESETS } from '@/lib/store-screenshots/engine/presets'
import { BUNDLED_FONTS } from '@/lib/store-screenshots/fonts'
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
  const count = selected.length
  const [background, setBackground] = React.useState<Background>(firstSlide?.background ?? theme.background)
  const [modelId, setModelId] = React.useState(theme.deviceFrame.modelId)
  const model = getDeviceModel(modelId)

  return (
    <>
      <Section title={`${count} slides selected`} description="Changes here apply to the selected slides only and undo as one step.">
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
            setBackground(next)
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
          value={BUNDLED_FONTS[0].value}
          onChange={(fontFamily) => api.getState().dispatch({ type: 'slides.patchText', slideIds: selected, roles: ['heading', 'subheading', 'body'], style: { fontFamily } })}
        />
        <SelectField
          label="Heading weight"
          value=""
          options={[{ value: '', label: 'Choose…' }, ...WEIGHT_OPTIONS]}
          onChange={(value) => value && api.getState().dispatch({ type: 'slides.patchText', slideIds: selected, roles: ['heading'], style: { fontWeight: Number(value) } })}
        />
        <ColorField
          label="Heading color"
          value={null}
          allowAuto
          resolved="#111111"
          palette={theme.palette}
          onChange={(color) => api.getState().dispatch({ type: 'slides.patchText', slideIds: selected, roles: ['heading'], style: { color } }, { key: `bulk-heading-color:${selected.join(',')}` })}
        />
        <ColorField
          label="Subheading color"
          value={null}
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
            setModelId(value)
            api.getState().dispatch({ type: 'slides.patchDevices', slideIds: selected, frame: { modelId: value, finishId: getDeviceModel(value).finishes[0].id } })
          }}
        />
        <SelectField
          label="Finish"
          value=""
          options={[{ value: '', label: 'Choose…' }, ...model.finishes.map((finish) => ({ value: finish.id, label: finish.name }))]}
          onChange={(finishId) => finishId && api.getState().dispatch({ type: 'slides.patchDevices', slideIds: selected, frame: { modelId, finishId } })}
        />
        <SelectField<DeviceStyle | ''>
          label="Style"
          value=""
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
