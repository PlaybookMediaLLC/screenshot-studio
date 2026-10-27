'use client'

import * as React from 'react'
import { panoramaFor } from '@/lib/store-screenshots/engine/scene'
import { LAYOUT_PRESETS, resolveLayoutId } from '@/lib/store-screenshots/engine/presets'
import type { LayoutId } from '@/lib/store-screenshots/document/schema'
import { cn } from '@/lib/utils'
import { useActiveScene } from '../active-scene'
import { useStudioActions } from '../actions'
import { Section, ToggleField } from '../controls'
import { useEditor, useEditorApi } from '../editor-store'
import { BackgroundField } from './BackgroundField'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

/** A small schematic of a layout preset, drawn from its slot geometry. */
export function LayoutGlyph({ layoutId, className }: { layoutId: LayoutId; className?: string }): React.JSX.Element {
  const preset = LAYOUT_PRESETS.find((item) => item.id === layoutId)!
  const copyY = preset.copy.anchor === 'middle' ? 40 : preset.copy.margin
  return (
    <svg viewBox="0 0 46 100" className={className} aria-hidden="true">
      <rect x="0.5" y="0.5" width="45" height="99" rx="3" fill="none" stroke="currentColor" strokeOpacity="0.25" />
      <rect x={(preset.copy.x / 100) * 46} y={copyY} width={(preset.copy.width / 100) * 46} height={preset.copy.anchor === 'middle' ? 16 : 9 * preset.copy.scale} rx="1.5" fill="currentColor" opacity="0.55" />
      {preset.slots.map((slot, index) => {
        const width = (slot.width / 100) * 46 * (slot.family === 'tablet' ? 1 : 0.62)
        const height = slot.family === 'tablet' ? width * 1.3 : width * 2
        return (
          <rect
            key={index}
            x={(slot.x / 100) * 46 - width / 2}
            y={slot.y - height / 2}
            width={width}
            height={height}
            rx="2.5"
            fill="currentColor"
            opacity="0.3"
            transform={`rotate(${slot.rotation} ${(slot.x / 100) * 46} ${slot.y})`}
          />
        )
      })}
    </svg>
  )
}

/** Inspector shown when nothing is selected: the slide itself. */
export function SlidePanel(): React.JSX.Element {
  const api = useEditorApi()
  const actions = useStudioActions()
  const document = useEditor((state) => state.document)
  const targetId = useEditor((state) => state.targetId)
  const overrideMode = useEditor((state) => state.targetOverrideMode)
  const { slide, index, target } = useActiveScene()
  const layoutId = resolveLayoutId(document, index)
  const membership = panoramaFor(document, slide.id)
  const hasOverrides = Boolean(slide.targetOverrides[targetId])
  const next = document.slides.slice(index + 1, index + 3)
  const nextFree = next.filter((candidate) => !panoramaFor(document, candidate.id))

  return (
    <>
      <Section title="Slide">
        <div className="space-y-1">
          <Label htmlFor="slide-name" className="block text-[11px] text-muted-foreground">
            Name
          </Label>
          <Input
            id="slide-name"
            key={slide.id}
            defaultValue={slide.name}
            maxLength={80}
            onBlur={(event) => {
              const name = event.target.value.trim()
              if (name && name !== slide.name) api.getState().dispatch({ type: 'slides.patch', slideIds: [slide.id], patch: { name } })
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
            }}
            className="h-8 w-full rounded-md border border-foreground/10 bg-foreground/[0.035] px-2 text-xs outline-none focus:border-foreground/30"
          />
        </div>
      </Section>
      <Section title="Layout" description={slide.layout ? undefined : 'Following the template rhythm. Pick a layout to fix this slide.'}>
        <div className="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label="Layout">
          {LAYOUT_PRESETS.map((preset) => (
            <Button variant="custom" size={null}
              key={preset.id}
              type="button"
              role="radio"
              aria-checked={layoutId === preset.id}
              aria-label={preset.name}
              title={`${preset.name}: ${preset.description}`}
              onClick={() => api.getState().dispatch({ type: 'slides.setLayout', slideIds: [slide.id], layout: preset.id })}
              className={cn(
                'flex flex-col items-center gap-1 rounded-md border p-1.5 text-[9px] leading-tight',
                layoutId === preset.id ? 'border-foreground/40 bg-foreground/[0.08] text-foreground' : 'border-foreground/10 text-muted-foreground hover:bg-foreground/[0.04]'
              )}
            >
              <LayoutGlyph layoutId={preset.id} className="h-10 w-5" />
              <span className="truncate">{preset.name}</span>
            </Button>
          ))}
        </div>
        {slide.layout ? (
          <Button variant="custom" size={null} type="button" onClick={() => api.getState().dispatch({ type: 'slides.setLayout', slideIds: [slide.id], layout: null })} className="text-[11px] text-muted-foreground underline underline-offset-2">
            Follow the template rhythm again
          </Button>
        ) : null}
      </Section>
      {membership ? (
        <Section title="Panorama" description={`Slide ${membership.index + 1} of a ${membership.panorama.slideIds.length}-slide panorama. Its background and shared layers continue across the slides.`}>
          <BackgroundField
            value={membership.panorama.background}
            palette={document.theme.palette}
            onChange={(background, asset) => {
              if (!background) return
              api.getState().dispatchMany(
                [...(asset ? [{ type: 'assets.add' as const, assets: [asset] }] : []), { type: 'panorama.patch', panoramaId: membership.panorama.id, background }],
                'Edit panorama'
              )
            }}
          />
          <div className="flex gap-2">
            <Button variant="custom" size={null} type="button" onClick={() => api.getState().dispatch({ type: 'panorama.detach', panoramaId: membership.panorama.id })} className="h-8 flex-1 rounded-md border border-foreground/10 text-[11px] hover:bg-foreground/[0.05]" title="Split into independent slides that keep the same look">
              Detach slides
            </Button>
            <Button variant="custom" size={null} type="button" onClick={() => api.getState().dispatch({ type: 'panorama.remove', panoramaId: membership.panorama.id })} className="h-8 flex-1 rounded-md border border-destructive/30 text-[11px] text-destructive hover:bg-destructive/10" title="Remove the shared background and layers">
              Remove panorama
            </Button>
          </div>
        </Section>
      ) : (
        <Section title="Background">
          <BackgroundField
            value={slide.background ?? document.theme.background}
            allowInherit={slide.background !== null}
            palette={document.theme.palette}
            onChooseImage={actions.chooseBackgroundImage}
            onChange={(background, asset) =>
              api.getState().dispatchMany(
                [...(asset ? [{ type: 'assets.add' as const, assets: [asset] }] : []), { type: 'slides.patch', slideIds: [slide.id], patch: { background } }],
                'Change background',
                { key: `background:${slide.id}` }
              )
            }
          />
          {nextFree.length > 0 ? (
            <div className="flex gap-2 border-t border-foreground/[0.07] pt-3">
              <Button variant="custom" size={null} type="button" onClick={() => api.getState().dispatch({ type: 'panorama.create', slideIds: [slide.id, nextFree[0].id] })} className="h-8 flex-1 rounded-md border border-foreground/10 text-[11px] hover:bg-foreground/[0.05]">
                Panorama with next slide
              </Button>
              {nextFree.length > 1 && nextFree[0].id === next[0]?.id ? (
                <Button variant="custom" size={null} type="button" onClick={() => api.getState().dispatch({ type: 'panorama.create', slideIds: [slide.id, nextFree[0].id, nextFree[1].id] })} className="h-8 flex-1 rounded-md border border-foreground/10 text-[11px] hover:bg-foreground/[0.05]">
                  Across 3 slides
                </Button>
              ) : null}
            </div>
          ) : null}
        </Section>
      )}
      <Section title={`Size: ${target.shortName}`} description="Shared changes adapt to every export size. Turn this on to fine-tune only this size.">
        <ToggleField label="Canvas edits apply to this size only" checked={overrideMode} onChange={(enabled) => api.getState().setTargetOverrideMode(enabled)} />
        {hasOverrides ? (
          <Button variant="custom" size={null}
            type="button"
            onClick={() =>
              api.getState().dispatchMany(
                Object.keys(slide.targetOverrides[targetId]).map((layerId) => ({ type: 'targetOverride.set' as const, slideId: slide.id, targetId, layerId, transform: null })),
                'Clear size adjustments'
              )
            }
            className="text-[11px] text-muted-foreground underline underline-offset-2"
          >
            Clear adjustments for {target.shortName}
          </Button>
        ) : null}
      </Section>
      <Section title="Style and reset">
        <Button variant="custom" size={null} type="button" onClick={() => actions.openDialog('applyStyle')} className="h-8 w-full rounded-md border border-foreground/10 text-[11px] hover:bg-foreground/[0.05]">
          Apply this slide&apos;s style to other slides…
        </Button>
        <div className="flex gap-2">
          <Button variant="custom" size={null}
            type="button"
            onClick={() => {
              const ids = slide.layers.filter((layer) => layer.type === 'device').map((layer) => layer.id)
              if (ids.length) api.getState().dispatch({ type: 'reset.devices', owner: { kind: 'slide', id: slide.id }, layerIds: ids })
            }}
            className="h-8 flex-1 rounded-md border border-foreground/10 text-[11px] hover:bg-foreground/[0.05]"
            title="Only devices move back; text stays where it is"
          >
            Reset devices
          </Button>
          <Button variant="custom" size={null}
            type="button"
            onClick={() => {
              const ids = slide.layers.filter((layer) => layer.type === 'text').map((layer) => layer.id)
              if (ids.length) api.getState().dispatch({ type: 'reset.text', owner: { kind: 'slide', id: slide.id }, layerIds: ids, scope: 'position' })
            }}
            className="h-8 flex-1 rounded-md border border-foreground/10 text-[11px] hover:bg-foreground/[0.05]"
            title="Only text moves back; devices stay where they are"
          >
            Reset text positions
          </Button>
        </div>
        <Button variant="custom" size={null} type="button" onClick={() => actions.openDialog('resetSlide')} className="h-8 w-full rounded-md border border-destructive/30 text-[11px] text-destructive hover:bg-destructive/10">
          Reset entire slide…
        </Button>
      </Section>
    </>
  )
}
