'use client'

import * as React from 'react'
import type { LayerOwner } from '@/lib/store-screenshots/commands/schema'
import { DEVICE_MODELS, DEVICE_STYLE_LABELS, getDeviceModel } from '@/lib/store-screenshots/devices'
import { createCallout } from '@/lib/store-screenshots/document/elements'
import { deviceStyleSchema, type DeviceLayer } from '@/lib/store-screenshots/document/schema'
import type { SceneDevice } from '@/lib/store-screenshots/engine/scene'
import { cn } from '@/lib/utils'
import { useActiveScene } from '../active-scene'
import { useStudioActions } from '../actions'
import { ChoiceField, NumberField, Section, SelectField, SliderField, ToggleField } from '../controls'
import { useEditor, useEditorApi } from '../editor-store'
import { LayerStateSection, TransformSection, useLayerPatch } from './shared'

const FAMILY_LABELS = { phone: 'Phones', tablet: 'Tablets', laptop: 'Mac', watch: 'Watch', headset: 'Vision Pro' } as const

/** Inspector for a device layer. */
export function DevicePanel({ owner, layer, node }: { owner: LayerOwner; layer: DeviceLayer; node: SceneDevice | undefined }): React.JSX.Element {
  const api = useEditorApi()
  const actions = useStudioActions()
  const patch = useLayerPatch(owner)
  const asset = useEditor((state) => (layer.assetId ? state.document.assets[layer.assetId] : undefined))
  const { slide } = useActiveScene()
  const shadow = useEditor((state) => state.document.theme.shadow)
  const model = getDeviceModel(layer.frame.modelId)
  const bar = layer.statusBar
  const statusBarSupported = model.statusBar && layer.frame.style !== 'screen-only'
  const likelyHasBar = asset ? Math.abs(asset.width / asset.height - model.screenAspect) < 0.02 : false

  return (
    <>
      <Section title="Screenshot">
        <div className="flex items-center gap-2 rounded-md border border-foreground/10 bg-foreground/[0.025] p-2">
          <span className="min-w-0 flex-1 truncate text-[11px]">{asset ? `${asset.name} · ${asset.width} × ${asset.height}` : 'No screenshot yet'}</span>
          <button
            type="button"
            onClick={() => actions.chooseScreenshot(owner.kind === 'slide' ? { slideId: owner.id, layerId: layer.id } : null)}
            className="h-7 shrink-0 rounded-md border border-foreground/10 px-2 text-[11px] hover:bg-foreground/[0.05]"
          >
            {asset ? 'Replace' : 'Choose'}
          </button>
        </div>
        {asset ? (
          <>
            <ChoiceField
              label="Fit"
              value={layer.image.mode}
              options={[
                { value: 'fill', label: 'Fill' },
                { value: 'fit', label: 'Fit' },
                { value: 'custom', label: 'Crop' },
              ]}
              onChange={(mode) => {
                if (mode === 'custom') {
                  api.getState().selectLayers(owner, [layer.id], 'replace', { deep: true })
                  api.getState().setCropping(layer.id)
                  return
                }
                patch([layer.id], { image: { mode, scale: 1, offsetX: 0, offsetY: 0 } })
              }}
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  api.getState().selectLayers(owner, [layer.id], 'replace', { deep: true })
                  api.getState().setCropping(layer.id)
                }}
                className="h-8 flex-1 rounded-md border border-foreground/10 text-[11px] hover:bg-foreground/[0.05]"
              >
                Crop on canvas
              </button>
              <button type="button" onClick={() => patch([layer.id], { image: { mode: 'fill', scale: 1, offsetX: 0, offsetY: 0 } })} className="h-8 flex-1 rounded-md border border-foreground/10 text-[11px] hover:bg-foreground/[0.05]">
                Reset crop
              </button>
            </div>
            {owner.kind === 'slide' ? (
              <button
                type="button"
                onClick={() => {
                  const callout = createCallout(layer.id)
                  api.getState().dispatch({ type: 'layers.add', owner, layers: [callout] })
                  api.getState().selectLayers(owner, [callout.id])
                  api.getState().setPickingCallout(callout.id)
                }}
                className="h-8 w-full rounded-md border border-foreground/10 text-[11px] hover:bg-foreground/[0.05]"
              >
                Add magnified callout
              </button>
            ) : null}
          </>
        ) : null}
      </Section>

      <Section title="Device">
        <SelectField
          label="Model"
          value={layer.frame.modelId}
          options={DEVICE_MODELS.map((item) => ({ value: item.id, label: `${FAMILY_LABELS[item.family]} · ${item.name}` }))}
          onChange={(modelId) => {
            const next = getDeviceModel(modelId)
            patch([layer.id], { frame: { modelId, finishId: next.finishes[0].id, orientation: next.supportsLandscape ? layer.frame.orientation : 'portrait' } })
          }}
        />
        <div className="space-y-1">
          <span className="block text-[11px] text-muted-foreground">Finish</span>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Finish">
            {model.finishes.map((finish) => (
              <button
                key={finish.id}
                type="button"
                role="radio"
                aria-checked={layer.frame.finishId === finish.id}
                aria-label={finish.name}
                title={finish.name}
                onClick={() => patch([layer.id], { frame: { finishId: finish.id } })}
                className={cn('size-6 rounded-full border border-foreground/20', layer.frame.finishId === finish.id && 'ring-2 ring-foreground/50 ring-offset-2 ring-offset-background')}
                style={{ background: `linear-gradient(135deg, ${finish.body}, ${finish.edge})` }}
              />
            ))}
          </div>
          {model.photo ? (
            <p className="text-[10px] text-muted-foreground">
              Realistic {model.finishes.find((finish) => finish.id === model.photo?.finishId)?.name} uses a photographed frame; other finishes are drawn.
            </p>
          ) : null}
        </div>
        <ChoiceField
          label="Style"
          value={layer.frame.style}
          options={deviceStyleSchema.options.map((style) => ({ value: style, label: DEVICE_STYLE_LABELS[style] }))}
          onChange={(style) => patch([layer.id], { frame: { style } })}
        />
        {model.supportsLandscape && layer.frame.style !== 'screen-only' ? (
          <ChoiceField
            label="Orientation"
            value={layer.frame.orientation}
            options={[
              { value: 'portrait', label: 'Portrait' },
              { value: 'landscape', label: 'Landscape' },
            ]}
            onChange={(orientation) => patch([layer.id], { frame: { orientation } })}
          />
        ) : null}
        <SliderField label="Shadow (all devices)" unit="%" value={shadow} min={0} max={100} onChange={(shadow) => api.getState().dispatch({ type: 'theme.patch', patch: { shadow } }, { key: 'theme-shadow' })} />
      </Section>

      <Section title="Status bar" description={statusBarSupported ? 'Drawn over the screen; your screenshot is never changed.' : 'This device style has no status bar.'}>
        {statusBarSupported ? (
          <>
            <ToggleField label="Show status bar" checked={bar.visible} onChange={(visible) => patch([layer.id], { statusBar: { visible } })} />
            {bar.visible ? (
              <>
                {likelyHasBar && !bar.cover ? (
                  <p className="rounded-md bg-amber-500/10 p-2 text-[11px] text-amber-800 dark:text-amber-200">
                    This screenshot looks like a full-screen capture and probably has its own status bar. Turn on “Cover the original” to avoid two bars.
                  </p>
                ) : null}
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="block text-[11px] text-muted-foreground" htmlFor={`time-${layer.id}`}>
                      Time
                    </label>
                    <div className="flex gap-1">
                      <input
                        id={`time-${layer.id}`}
                        value={bar.time}
                        maxLength={8}
                        onChange={(event) => patch([layer.id], { statusBar: { time: event.target.value } }, 'bar-time')}
                        className="h-8 min-w-0 flex-1 rounded-md border border-foreground/10 bg-foreground/[0.035] px-2 text-xs outline-none"
                      />
                      <button type="button" onClick={() => patch([layer.id], { statusBar: { time: '9:41' } })} className="h-8 rounded-md border border-foreground/10 px-1.5 text-[10px]">
                        9:41
                      </button>
                    </div>
                  </div>
                  <NumberField label="Battery" unit="%" value={bar.battery} min={0} max={100} onChange={(battery) => patch([layer.id], { statusBar: { battery } }, 'bar-battery')} />
                  <NumberField label="Signal bars" value={bar.signal} min={0} max={4} onChange={(signal) => patch([layer.id], { statusBar: { signal } }, 'bar-signal')} />
                  <NumberField label="Wi-Fi bars" value={bar.wifi} min={0} max={3} onChange={(wifi) => patch([layer.id], { statusBar: { wifi } }, 'bar-wifi')} hint="0 hides Wi-Fi" />
                </div>
                <div className="space-y-1">
                  <label className="block text-[11px] text-muted-foreground" htmlFor={`carrier-${layer.id}`}>
                    Carrier
                  </label>
                  <input
                    id={`carrier-${layer.id}`}
                    value={bar.carrier}
                    maxLength={24}
                    placeholder="None"
                    onChange={(event) => patch([layer.id], { statusBar: { carrier: event.target.value } }, 'bar-carrier')}
                    className="h-8 w-full rounded-md border border-foreground/10 bg-foreground/[0.035] px-2 text-xs outline-none"
                  />
                </div>
                <ChoiceField
                  label="Text color"
                  value={bar.appearance}
                  options={[
                    { value: 'auto', label: 'Auto' },
                    { value: 'dark', label: 'Dark' },
                    { value: 'light', label: 'Light' },
                  ]}
                  onChange={(appearance) => patch([layer.id], { statusBar: { appearance } })}
                />
                <ToggleField
                  label="Cover the original"
                  checked={bar.cover}
                  onChange={(cover) => patch([layer.id], { statusBar: { cover } })}
                  hint="Paints the screenshot's own top color behind the drawn bar so an existing bar does not show twice."
                />
              </>
            ) : null}
          </>
        ) : null}
      </Section>

      <Section title="Adjustments">
        <SliderField label="Brightness" unit="%" value={layer.filters.brightness} min={50} max={150} onChange={(brightness) => patch([layer.id], { filters: { brightness } }, 'brightness')} />
        <SliderField label="Contrast" unit="%" value={layer.filters.contrast} min={50} max={150} onChange={(contrast) => patch([layer.id], { filters: { contrast } }, 'contrast')} />
        <SliderField label="Saturation" unit="%" value={layer.filters.saturation} min={0} max={180} onChange={(saturation) => patch([layer.id], { filters: { saturation } }, 'saturation')} />
      </Section>

      <TransformSection owner={owner} layer={layer} node={node} tilt title="Position and tilt" />
      <Section title="Reset">
        <div className="flex gap-2">
          <button type="button" onClick={() => api.getState().dispatch({ type: 'reset.devices', owner, layerIds: [layer.id] })} className="h-8 flex-1 rounded-md border border-foreground/10 text-[11px] hover:bg-foreground/[0.05]" title="Moves the device back to its layout position. Text is not affected.">
            Reset device position
          </button>
          <button type="button" onClick={() => api.getState().dispatch({ type: 'reset.layer', owner, layerId: layer.id })} className="h-8 flex-1 rounded-md border border-foreground/10 text-[11px] hover:bg-foreground/[0.05]" title="Position, crop, and adjustments">
            Reset all
          </button>
        </div>
        {layer.placement.mode === 'auto' ? (
          <p className="text-[10px] text-muted-foreground">Placed by the {slide.layout ?? 'template'} layout, slot {layer.placement.slot + 1}.</p>
        ) : null}
      </Section>
      <LayerStateSection owner={owner} layer={layer} />
    </>
  )
}
