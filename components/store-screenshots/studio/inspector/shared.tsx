'use client'

import * as React from 'react'
import type { LayerOwner, LayerPatch } from '@/lib/store-screenshots/commands/schema'
import type { LayerTransform, StoreLayer } from '@/lib/store-screenshots/document/schema'
import { roundTo } from '@/lib/store-screenshots/engine/geometry'
import type { SceneNode } from '@/lib/store-screenshots/engine/scene'
import { useActiveScene } from '../active-scene'
import { NumberField, Section, SliderField } from '../controls'
import { useEditor, useEditorApi } from '../editor-store'

/** Patch helpers bound to one layer owner. Continuous edits coalesce by key. */
export function useLayerPatch(owner: LayerOwner) {
  const api = useEditorApi()
  return React.useCallback(
    (layerIds: string[], patch: LayerPatch, key?: string) => {
      api.getState().dispatch({ type: 'layers.patch', owner, layerIds, patch }, key ? { key: `${key}:${layerIds.join(',')}` } : undefined)
    },
    [api, owner]
  )
}

/** Width the layer's horizontal percentages refer to (a slide, or a whole panorama). */
export function useBaseWidth(node: SceneNode | undefined): number {
  const { scene, size } = useActiveScene()
  return node?.panorama && scene?.panorama ? size.width * scene.panorama.count : size.width
}

/**
 * Position, size, rotation, and tilt of one layer, in pixels at the canvas
 * target size. Free layers show their centre position; layout-managed layers
 * show their offset from where the layout puts them.
 */
export function TransformSection({
  owner,
  layer,
  node,
  tilt = false,
  title = 'Position',
}: {
  owner: LayerOwner
  layer: StoreLayer
  node: SceneNode | undefined
  tilt?: boolean
  title?: string
}): React.JSX.Element {
  const api = useEditorApi()
  const { size, slide } = useActiveScene()
  const overrideMode = useEditor((state) => state.targetOverrideMode)
  const targetId = useEditor((state) => state.targetId)
  const baseWidth = useBaseWidth(node)
  const transform: LayerTransform =
    overrideMode && owner.kind === 'slide' ? { ...layer.transform, ...(slide.targetOverrides[targetId]?.[layer.id] ?? {}) } : layer.transform
  const free = 'placement' in layer && layer.placement.mode === 'free'
  const baseX = free && 'placement' in layer && layer.placement.mode === 'free' ? layer.placement.x : 0
  const baseY = free && 'placement' in layer && layer.placement.mode === 'free' ? layer.placement.y : 0
  const write = (patch: Partial<LayerTransform>, key: string) =>
    api.getState().dispatch(
      { type: 'layers.setTransforms', owner, transforms: { [layer.id]: patch }, targetId: overrideMode && owner.kind === 'slide' ? targetId : null },
      { key: `${key}:${layer.id}` }
    )
  const toPx = (percent: number, base: number) => roundTo((percent / 100) * base, 0)
  const fromPx = (px: number, base: number) => (px / base) * 100
  return (
    <Section
      title={title}
      description={free ? 'Centre position in pixels at the canvas size.' : 'Offset from where the layout places it, in pixels at the canvas size.'}
    >
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label={free ? 'X' : 'Offset X'}
          unit="px"
          value={toPx(baseX + transform.offsetX, baseWidth)}
          min={-baseWidth * 2}
          max={baseWidth * 2}
          onChange={(value) => write({ offsetX: fromPx(value, baseWidth) - baseX }, 'offsetX')}
        />
        <NumberField
          label={free ? 'Y' : 'Offset Y'}
          unit="px"
          value={toPx(baseY + transform.offsetY, size.height)}
          min={-size.height * 2}
          max={size.height * 2}
          onChange={(value) => write({ offsetY: fromPx(value, size.height) - baseY }, 'offsetY')}
        />
        <NumberField label="Scale" unit="%" value={transform.scale * 100} min={10} max={500} onChange={(value) => write({ scale: value / 100 }, 'scale')} />
        <NumberField label="Rotation" unit="°" value={transform.rotation} min={-180} max={180} precision={1} onChange={(value) => write({ rotation: value }, 'rotation')} />
      </div>
      {tilt ? (
        <div className="space-y-3 pt-1">
          <SliderField label="Tilt forward" unit="°" value={transform.tiltX} min={-45} max={45} onChange={(value) => write({ tiltX: value }, 'tiltX')} />
          <SliderField label="Turn sideways" unit="°" value={transform.tiltY} min={-45} max={45} onChange={(value) => write({ tiltY: value }, 'tiltY')} />
        </div>
      ) : null}
    </Section>
  )
}

/** Opacity, visibility, and lock for any layer. */
export function LayerStateSection({ owner, layer }: { owner: LayerOwner; layer: StoreLayer }): React.JSX.Element {
  const patch = useLayerPatch(owner)
  return (
    <Section title="Layer">
      <div className="space-y-1">
        <label className="block text-[11px] text-muted-foreground" htmlFor={`name-${layer.id}`}>
          Name
        </label>
        <input
          id={`name-${layer.id}`}
          defaultValue={layer.name}
          key={layer.name}
          maxLength={80}
          onBlur={(event) => {
            const name = event.target.value.trim()
            if (name && name !== layer.name) patch([layer.id], { name })
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
          className="h-8 w-full rounded-md border border-foreground/10 bg-foreground/[0.035] px-2 text-xs outline-none focus:border-foreground/30"
        />
      </div>
      <SliderField label="Opacity" unit="%" value={Math.round(layer.opacity * 100)} min={0} max={100} onChange={(value) => patch([layer.id], { opacity: value / 100 }, 'opacity')} />
      <div className="flex gap-2">
        <button type="button" onClick={() => patch([layer.id], { hidden: !layer.hidden })} className="h-8 flex-1 rounded-md border border-foreground/10 text-[11px] hover:bg-foreground/[0.05]">
          {layer.hidden ? 'Show layer' : 'Hide layer'}
        </button>
        <button type="button" onClick={() => patch([layer.id], { locked: !layer.locked })} className="h-8 flex-1 rounded-md border border-foreground/10 text-[11px] hover:bg-foreground/[0.05]">
          {layer.locked ? 'Unlock' : 'Lock'}
        </button>
      </div>
    </Section>
  )
}
