'use client'

import * as React from 'react'
import { DEVICE_MODELS, DEVICE_STYLE_LABELS, getDeviceModel } from '@/lib/store-screenshots/devices'
import { ANNOTATION_LABELS, createAnnotation, createCallout } from '@/lib/store-screenshots/document/elements'
import { createDeviceLayer, createTextLayer, TEXT_ROLE_LABELS } from '@/lib/store-screenshots/document/factory'
import { annotationKindSchema, deviceStyleSchema, textRoleSchema, type DeviceLayer, type StoreLayer, type TextRole } from '@/lib/store-screenshots/document/schema'
import { localeStatus } from '@/lib/store-screenshots/localization'
import { localeName, STORE_LOCALES } from '@/lib/store-screenshots/locales'
import { cn } from '@/lib/utils'
import { useActiveScene } from '../active-scene'
import { useStudioActions } from '../actions'
import { ColorField, Section, SelectField, SliderField, ToggleField } from '../controls'
import { useEditor, useEditorApi } from '../editor-store'
import { BackgroundField } from '../inspector/BackgroundField'
import { TypographyFields } from '../inspector/TextPanel'

const insertButton = 'flex h-9 items-center gap-2 rounded-md border border-foreground/10 px-2.5 text-left text-[11px] hover:bg-foreground/[0.05] disabled:opacity-40'

/** Add text, devices, annotations, callouts, and images to the active slide. */
export function InsertPanel(): React.JSX.Element {
  const api = useEditorApi()
  const actions = useStudioActions()
  const { slide } = useActiveScene()
  const palette = useEditor((state) => state.document.theme.palette)
  const themeFrame = useEditor((state) => state.document.theme.deviceFrame)
  const [modelId, setModelId] = React.useState(themeFrame.modelId)
  const owner = { kind: 'slide' as const, id: slide.id }
  const devices = slide.layers.filter((layer): layer is DeviceLayer => layer.type === 'device')
  const add = (layer: StoreLayer) => {
    api.getState().dispatch({ type: 'layers.add', owner, layers: [layer] })
    api.getState().selectLayers(owner, [layer.id])
  }
  // Cascade new annotations so several added in a row do not stack on one spot.
  const nextAnnotationY = 30 + ((slide.layers.filter((layer) => layer.type === 'annotation').length * 11) % 55)
  const addText = (role: TextRole) => {
    const slots = slide.layers.flatMap((layer) => (layer.type === 'text' && layer.placement.mode === 'auto' ? [layer.placement.slot] : []))
    add(createTextLayer(role, role === 'heading' ? 'New heading' : role === 'subheading' ? 'Explain the benefit' : 'Add a detail', { placement: { mode: 'auto', slot: Math.max(role === 'heading' ? 0 : role === 'subheading' ? 1 : 2, ...slots.map((slot) => slot + 1)) } }))
  }
  return (
    <div className="space-y-0">
      <Section title="Text" description="New text joins the copy area, so the layout keeps space for it.">
        <div className="grid grid-cols-3 gap-1.5">
          {textRoleSchema.options.map((role) => (
            <button key={role} type="button" className={insertButton} onClick={() => addText(role)}>
              {TEXT_ROLE_LABELS[role]}
            </button>
          ))}
        </div>
      </Section>
      <Section title="Devices" description="Each device shows its own screenshot and can be moved, rotated, and cropped independently.">
        <SelectField label="Model" value={modelId} options={DEVICE_MODELS.map((model) => ({ value: model.id, label: model.name }))} onChange={setModelId} />
        <button
          type="button"
          className={cn(insertButton, 'w-full')}
          onClick={() => {
            const model = getDeviceModel(modelId)
            const device = createDeviceLayer(devices[0]?.assetId ?? null, 0, { ...themeFrame, modelId, finishId: model.finishes[0].id }, {
              placement: { mode: 'free', x: 50 + devices.length * 6, y: 62, width: model.family === 'tablet' ? 70 : model.family === 'laptop' ? 86 : 48 },
              name: model.name,
            })
            add(device)
          }}
        >
          Add {getDeviceModel(modelId).name}
        </button>
        <button type="button" className={cn(insertButton, 'w-full')} onClick={() => actions.openDialog('import')}>
          Import screenshots as new slides…
        </button>
      </Section>
      <Section title="Badges and annotations" description="Ratings and awards start empty: only add claims you can back up.">
        <div className="grid grid-cols-2 gap-1.5">
          {annotationKindSchema.options.map((kind) => (
            <button key={kind} type="button" className={insertButton} onClick={() => add(createAnnotation(kind, palette[2] ?? '#6D28D9', 50, nextAnnotationY))}>
              {ANNOTATION_LABELS[kind]}
            </button>
          ))}
        </div>
      </Section>
      <Section title="Callouts and images">
        <button
          type="button"
          disabled={!devices.some((device) => device.assetId)}
          className={cn(insertButton, 'w-full')}
          title={devices.length ? 'Magnify part of a screenshot' : 'Add a device with a screenshot first'}
          onClick={() => {
            const source = devices.find((device) => device.assetId)!
            const callout = createCallout(source.id)
            add(callout)
            api.getState().setPickingCallout(callout.id)
          }}
        >
          Magnified callout
        </button>
        <button type="button" className={cn(insertButton, 'w-full')} onClick={actions.chooseImageLayer}>
          Image or logo…
        </button>
      </Section>
    </div>
  )
}

/** Project-wide style: role typography, default background, device defaults, palette. */
export function StylePanel(): React.JSX.Element {
  const api = useEditorApi()
  const actions = useStudioActions()
  const document = useEditor((state) => state.document)
  const [role, setRole] = React.useState<TextRole>('heading')
  const [overrideSlides, setOverrideSlides] = React.useState(false)
  const theme = document.theme
  const frame = theme.deviceFrame
  const model = getDeviceModel(frame.modelId)
  return (
    <div>
      <Section title="Brand and templates">
        <div className="grid grid-cols-2 gap-1.5">
          <button type="button" className={insertButton} onClick={() => actions.openDialog('brandKits')}>
            Brand kits…
          </button>
          <button type="button" className={insertButton} onClick={() => actions.openDialog('templates')}>
            Templates…
          </button>
        </div>
      </Section>
      <Section title="Typography" description="Defaults for every slide. Slides keep their own changes unless you also replace them.">
        <div role="tablist" aria-label="Text role" className="flex gap-1">
          {textRoleSchema.options.map((item) => (
            <button key={item} type="button" role="tab" aria-selected={role === item} onClick={() => setRole(item)} className={cn('h-7 flex-1 rounded-md text-[11px]', role === item ? 'bg-foreground/[0.1] text-foreground' : 'text-muted-foreground hover:bg-foreground/[0.05]')}>
              {TEXT_ROLE_LABELS[item]}
            </button>
          ))}
        </div>
        <ToggleField label="Also replace slide-specific styles" checked={overrideSlides} onChange={setOverrideSlides} hint="On: every slide's custom size, font, or color for this role is cleared so the new default applies everywhere." />
        <TypographyFields
          style={theme.textStyles[role]}
          showColor
          palette={theme.palette}
          onChange={(style, key) => api.getState().dispatch({ type: 'theme.patchText', role, style, clearOverrides: overrideSlides }, { key: `theme-text:${role}:${key}` })}
        />
      </Section>
      <Section title="Default background">
        <BackgroundField
          value={theme.background}
          palette={theme.palette}
          onChange={(background, asset) =>
            background &&
            api.getState().dispatchMany([...(asset ? [{ type: 'assets.add' as const, assets: [asset] }] : []), { type: 'theme.patch', patch: { background } }], 'Change default background', { key: 'theme-background' })
          }
        />
      </Section>
      <Section title="Default device">
        <SelectField label="Model" value={frame.modelId} options={DEVICE_MODELS.map((item) => ({ value: item.id, label: item.name }))} onChange={(modelId) => api.getState().dispatch({ type: 'theme.patch', patch: { deviceFrame: { ...frame, modelId, finishId: getDeviceModel(modelId).finishes[0].id } } })} />
        <SelectField label="Finish" value={frame.finishId} options={model.finishes.map((finish) => ({ value: finish.id, label: finish.name }))} onChange={(finishId) => api.getState().dispatch({ type: 'theme.patch', patch: { deviceFrame: { ...frame, finishId } } })} />
        <SelectField label="Style" value={frame.style} options={deviceStyleSchema.options.map((style) => ({ value: style, label: DEVICE_STYLE_LABELS[style] }))} onChange={(style) => api.getState().dispatch({ type: 'theme.patch', patch: { deviceFrame: { ...frame, style } } })} />
        <button
          type="button"
          className={cn(insertButton, 'w-full')}
          onClick={() => api.getState().dispatch({ type: 'slides.patchDevices', slideIds: document.slides.map((slide) => slide.id), frame: { ...frame } })}
        >
          Use this device on every slide
        </button>
        <SliderField label="Shadow" unit="%" value={theme.shadow} min={0} max={100} onChange={(shadow) => api.getState().dispatch({ type: 'theme.patch', patch: { shadow } }, { key: 'theme-shadow' })} />
      </Section>
      <Section title="Palette" description="Offered by every color picker.">
        <div className="grid grid-cols-2 gap-2">
          {theme.palette.map((color, index) => (
            <ColorField
              key={index}
              label={`Color ${index + 1}`}
              value={color}
              onChange={(next) => {
                if (!next) return
                const palette = [...theme.palette]
                palette[index] = next
                api.getState().dispatch({ type: 'theme.patch', patch: { palette } }, { key: `palette:${index}` })
              }}
            />
          ))}
        </div>
      </Section>
    </div>
  )
}

/** Languages: add locales, switch the editing language, and see translation status. */
export function LanguagesPanel(): React.JSX.Element {
  const api = useEditorApi()
  const actions = useStudioActions()
  const document = useEditor((state) => state.document)
  const locale = useEditor((state) => state.locale)
  const { sourceLocale, locales } = document.localization
  const [adding, setAdding] = React.useState('')
  const available = STORE_LOCALES.filter((item) => item.code !== sourceLocale && !locales.includes(item.code))
  return (
    <div>
      <Section title="Editing language" description="Switch to a language to see and edit its copy on the canvas. Source copy is never changed by translations.">
        <div className="space-y-1">
          {[sourceLocale, ...locales].map((code) => {
            const status = code === sourceLocale ? null : localeStatus(document, code)
            return (
              <div key={code} className={cn('flex items-center gap-2 rounded-md border px-2 py-1.5', locale === code ? 'border-foreground/30 bg-foreground/[0.06]' : 'border-foreground/10')}>
                <button type="button" aria-pressed={locale === code} onClick={() => api.getState().setLocale(code)} className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-xs font-medium">{localeName(code)}</span>
                  <span className="block text-[10px] text-muted-foreground">
                    {status
                      ? `${status.total - status.missing}/${status.total} translated · ${status.approved} approved${status.outdated ? ` · ${status.outdated} outdated` : ''}`
                      : `${code} · source`}
                  </span>
                </button>
                {status ? (
                  <button
                    type="button"
                    aria-label={`Remove ${localeName(code)}`}
                    title="Remove language (translations are kept until you remove them from text)"
                    onClick={() => {
                      api.getState().dispatch({ type: 'locales.set', locales: locales.filter((item) => item !== code) })
                      if (locale === code) api.getState().setLocale(sourceLocale)
                    }}
                    className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  >
                    ×
                  </button>
                ) : null}
              </div>
            )
          })}
        </div>
        <div className="flex gap-1.5">
          <select aria-label="Add a language" value={adding} onChange={(event) => setAdding(event.target.value)} className="h-8 min-w-0 flex-1 rounded-md border border-foreground/10 bg-foreground/[0.035] px-2 text-xs">
            <option value="">Add a language…</option>
            {available.map((item) => (
              <option key={item.code} value={item.code}>
                {item.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!adding}
            onClick={() => {
              api.getState().dispatch({ type: 'locales.set', locales: [...locales, adding] })
              setAdding('')
            }}
            className="h-8 rounded-md bg-foreground px-2.5 text-[11px] text-background disabled:opacity-40"
          >
            Add
          </button>
        </div>
      </Section>
      <Section title="Translate">
        <button type="button" disabled={locales.length === 0} onClick={() => actions.openDialog('translate')} className={cn(insertButton, 'w-full')}>
          Translate with AI…
        </button>
        <button type="button" onClick={() => actions.openDialog('copy')} className={cn(insertButton, 'w-full')}>
          Write headlines with AI…
        </button>
        <button type="button" onClick={() => actions.openDialog('checks')} className={cn(insertButton, 'w-full')}>
          Check text that no longer fits…
        </button>
      </Section>
    </div>
  )
}
