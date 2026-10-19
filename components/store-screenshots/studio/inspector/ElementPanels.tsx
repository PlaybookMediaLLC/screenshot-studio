'use client'

import * as React from 'react'
import type { LayerOwner } from '@/lib/store-screenshots/commands/schema'
import { CLAIM_KINDS } from '@/lib/store-screenshots/document/elements'
import type { AnnotationLayer, CalloutLayer, DeviceLayer, ImageLayer } from '@/lib/store-screenshots/document/schema'
import { rotatedBounds, unionRects, type Rect } from '@/lib/store-screenshots/engine/geometry'
import type { Axis } from '@/lib/store-screenshots/engine/snapping'
import type { SceneAnnotation, SceneCallout, SceneNode } from '@/lib/store-screenshots/engine/scene'
import { useActiveScene } from '../active-scene'
import { ChoiceField, ColorField, IconButton, NumberField, Section, SelectField, SliderField, ToggleField } from '../controls'
import { ownerLayers, useEditor, useEditorApi } from '../editor-store'
import { LayerStateSection, TransformSection, useBaseWidth, useLayerPatch } from './shared'
import { Label as UiLabel } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

/** Inspector for badges, arrows, ratings, and other annotations. */
export function AnnotationPanel({ owner, layer, node }: { owner: LayerOwner; layer: AnnotationLayer; node: SceneAnnotation | undefined }): React.JSX.Element {
  const patch = useLayerPatch(owner)
  const palette = useEditor((state) => state.document.theme.palette)
  const props = (values: Record<string, unknown>, key?: string) => patch([layer.id], { props: values }, key)
  const hasText = !['arrow', 'highlight'].includes(layer.kind)
  return (
    <>
      <Section title={layer.name} description={CLAIM_KINDS.has(layer.kind) ? 'Only show ratings, rankings, or awards you can substantiate, and name their source.' : undefined}>
        {hasText ? (
          <>
            <div className="space-y-1">
              <UiLabel className="block text-[11px] text-muted-foreground" htmlFor={`text-${layer.id}`}>
                {layer.kind === 'rating' ? 'Label (for example “4.8 · 12K ratings”)' : layer.kind === 'step' ? 'Text (empty shows the number)' : 'Text'}
              </UiLabel>
              <Input
                id={`text-${layer.id}`}
                data-inspector-focus="annotation-text"
                value={layer.text}
                maxLength={120}
                onChange={(event) => props({ text: event.target.value }, 'annotation-text')}
                className="h-8 w-full rounded-md border border-foreground/10 bg-foreground/[0.035] px-2 text-xs outline-none focus:border-foreground/30"
              />
            </div>
            {['rating', 'laurel', 'badge', 'label'].includes(layer.kind) ? (
              <div className="space-y-1">
                <UiLabel className="block text-[11px] text-muted-foreground" htmlFor={`caption-${layer.id}`}>
                  {layer.kind === 'laurel' || layer.kind === 'rating' ? 'Source' : 'Second line'}
                </UiLabel>
                <Input
                  id={`caption-${layer.id}`}
                  value={layer.caption}
                  maxLength={120}
                  onChange={(event) => props({ caption: event.target.value }, 'annotation-caption')}
                  className="h-8 w-full rounded-md border border-foreground/10 bg-foreground/[0.035] px-2 text-xs outline-none focus:border-foreground/30"
                />
              </div>
            ) : null}
          </>
        ) : null}
        {layer.kind === 'step' ? <NumberField label="Number" value={layer.value} min={0} max={99} onChange={(value) => props({ value }, 'value')} /> : null}
        {layer.kind === 'rating' ? <NumberField label="Stars" value={layer.value} min={0} max={5} step={0.5} precision={1} onChange={(value) => props({ value }, 'value')} hint="Use your real store rating." /> : null}
        {layer.kind === 'arrow' ? <SliderField label="Curve" value={layer.curve * 100} min={-100} max={100} unit="%" onChange={(value) => props({ curve: value / 100 }, 'curve')} /> : null}
        {layer.kind === 'highlight' ? (
          <ChoiceField
            label="Shape"
            value={layer.shape}
            options={[
              { value: 'rectangle', label: 'Rectangle' },
              { value: 'ellipse', label: 'Ellipse' },
            ]}
            onChange={(shape) => props({ shape })}
          />
        ) : null}
      </Section>
      <Section title="Style">
        <ColorField label={layer.kind === 'arrow' || layer.kind === 'highlight' ? 'Stroke' : 'Accent'} value={layer.color} palette={palette} onChange={(color) => color && props({ color }, 'color')} />
        {['step', 'label', 'badge', 'highlight'].includes(layer.kind) ? (
          <ColorField label="Fill" value={layer.fill ?? layer.color} palette={palette} onChange={(fill) => props({ fill }, 'fill')} />
        ) : null}
        {hasText ? <ColorField label="Text" value={layer.textColor} palette={palette} onChange={(textColor) => textColor && props({ textColor }, 'textColor')} /> : null}
        {['arrow', 'highlight', 'label', 'badge'].includes(layer.kind) ? (
          <SliderField label="Stroke width" unit="px" value={layer.strokeWidth} min={0} max={40} onChange={(strokeWidth) => props({ strokeWidth }, 'stroke')} />
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="Width" unit="%" value={layer.placement.width} min={1} max={300} precision={1} onChange={(width) => patch([layer.id], { placement: { ...layer.placement, width } }, 'width')} />
          <NumberField label="Height" unit="%" value={layer.height} min={0.5} max={200} precision={1} onChange={(height) => props({ height }, 'height')} />
        </div>
      </Section>
      <TransformSection owner={owner} layer={layer} node={node} />
      <LayerStateSection owner={owner} layer={layer} />
    </>
  )
}

/** Inspector for a magnified callout. */
export function CalloutPanel({ owner, layer, node }: { owner: LayerOwner; layer: CalloutLayer; node: SceneCallout | undefined }): React.JSX.Element {
  const api = useEditorApi()
  const patch = useLayerPatch(owner)
  const document = useEditor((state) => state.document)
  const palette = document.theme.palette
  const devices = ownerLayers(document, owner).filter((item): item is DeviceLayer => item.type === 'device')
  const props = (values: Record<string, unknown>, key?: string) => patch([layer.id], { props: values }, key)
  const region = layer.region
  return (
    <>
      <Section title="Magnified area" description={node?.regionHidden ? 'The chosen area is outside the visible screen. Pick an area again or change the crop.' : 'The callout follows its device when it moves, scales, rotates, or is re-cropped.'}>
        <SelectField label="Source device" value={layer.deviceLayerId} options={devices.map((device) => ({ value: device.id, label: device.name }))} onChange={(deviceLayerId) => props({ deviceLayerId })} />
        <Button variant="custom" size={null}
          type="button"
          onClick={() => api.getState().setPickingCallout(layer.id)}
          className="h-8 w-full rounded-md bg-foreground text-[11px] font-medium text-background"
        >
          Pick area on the screenshot
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="Area left" unit="%" value={region.x * 100} min={0} max={99} precision={1} onChange={(x) => props({ region: { ...region, x: x / 100 } }, 'region-x')} />
          <NumberField label="Area top" unit="%" value={region.y * 100} min={0} max={99} precision={1} onChange={(y) => props({ region: { ...region, y: y / 100 } }, 'region-y')} />
          <NumberField label="Area width" unit="%" value={region.width * 100} min={1} max={100} precision={1} onChange={(width) => props({ region: { ...region, width: width / 100 } }, 'region-w')} />
          <NumberField label="Area height" unit="%" value={region.height * 100} min={1} max={100} precision={1} onChange={(height) => props({ region: { ...region, height: height / 100 } }, 'region-h')} />
        </div>
      </Section>
      <Section title="Style">
        <ChoiceField
          label="Shape"
          value={layer.shape}
          options={[
            { value: 'circle', label: 'Circle' },
            { value: 'rounded', label: 'Rounded' },
            { value: 'square', label: 'Square' },
          ]}
          onChange={(shape) => props({ shape })}
        />
        <SliderField label="Border" unit="px" value={layer.borderWidth} min={0} max={40} onChange={(borderWidth) => props({ borderWidth }, 'border')} />
        <ColorField label="Border color" value={layer.borderColor} palette={palette} onChange={(borderColor) => borderColor && props({ borderColor }, 'border-color')} />
        <SliderField label="Shadow" unit="%" value={layer.shadow} min={0} max={100} onChange={(shadow) => props({ shadow }, 'shadow')} />
        <ToggleField label="Connector line" checked={layer.connector} onChange={(connector) => props({ connector })} />
        <NumberField label="Size" unit="% of width" value={layer.placement.width} min={5} max={100} precision={1} onChange={(width) => patch([layer.id], { placement: { ...layer.placement, width } }, 'width')} />
      </Section>
      <TransformSection owner={owner} layer={layer} node={node} />
      <LayerStateSection owner={owner} layer={layer} />
    </>
  )
}

/** Inspector for a free image layer. */
export function ImagePanel({ owner, layer, node }: { owner: LayerOwner; layer: ImageLayer; node: SceneNode | undefined }): React.JSX.Element {
  const patch = useLayerPatch(owner)
  return (
    <>
      <Section title="Image">
        <NumberField label="Width" unit="% of slide" value={layer.placement.width} min={1} max={300} precision={1} onChange={(width) => patch([layer.id], { placement: { ...layer.placement, width } }, 'width')} />
      </Section>
      <TransformSection owner={owner} layer={layer} node={node} />
      <LayerStateSection owner={owner} layer={layer} />
    </>
  )
}

const ALIGNMENTS = [
  { id: 'left', label: 'Align left edges', path: 'M5 3v18M9 7h10M9 15h6' },
  { id: 'centerX', label: 'Align horizontal centres', path: 'M12 3v18M6 7h12M8 15h8' },
  { id: 'right', label: 'Align right edges', path: 'M19 3v18M5 7h10M9 15h6' },
  { id: 'top', label: 'Align top edges', path: 'M3 5h18M7 9v10M15 9v6' },
  { id: 'centerY', label: 'Align vertical centres', path: 'M3 12h18M7 6v12M15 8v8' },
  { id: 'bottom', label: 'Align bottom edges', path: 'M3 19h18M7 5v10M15 9v6' },
] as const

/** Inspector for several layers: align, distribute, group, and arrange. */
export function MultiLayerPanel({ owner, layerIds }: { owner: LayerOwner; layerIds: string[] }): React.JSX.Element {
  const api = useEditorApi()
  const { scene, size } = useActiveScene()
  const nodes = (scene?.nodes ?? []).filter((node) => layerIds.includes(node.layerId))
  const baseWidth = useBaseWidth(nodes[0])
  const layers = useEditor((state) => ownerLayers(state.document, owner)).filter((layer) => layerIds.includes(layer.id))
  const grouped = layers.some((layer) => layer.groupId)

  const moveBy = (moves: Array<{ node: SceneNode; dx: number; dy: number }>, label: string) => {
    const transforms: Record<string, { offsetX: number; offsetY: number }> = {}
    for (const { node, dx, dy } of moves) {
      const layer = layers.find((item) => item.id === node.layerId)
      if (!layer || layer.locked) continue
      transforms[layer.id] = { offsetX: layer.transform.offsetX + (dx / baseWidth) * 100, offsetY: layer.transform.offsetY + (dy / size.height) * 100 }
    }
    api.getState().dispatchMany([{ type: 'layers.setTransforms', owner, transforms, targetId: null }], label)
  }

  const align = (mode: (typeof ALIGNMENTS)[number]['id']) => {
    const bounds = nodes.map((node) => ({ node, rect: rotatedBounds(node.box, node.rotation) }))
    const all = unionRects(bounds.map((item) => item.rect))
    if (!all) return
    moveBy(
      bounds.map(({ node, rect }) => {
        const target: Record<typeof mode, [number, number]> = {
          left: [all.x - rect.x, 0],
          centerX: [all.x + all.width / 2 - (rect.x + rect.width / 2), 0],
          right: [all.x + all.width - (rect.x + rect.width), 0],
          top: [0, all.y - rect.y],
          centerY: [0, all.y + all.height / 2 - (rect.y + rect.height / 2)],
          bottom: [0, all.y + all.height - (rect.y + rect.height)],
        }
        return { node, dx: target[mode][0], dy: target[mode][1] }
      }),
      'Align layers'
    )
  }

  const distribute = (axis: Axis) => {
    const items = nodes
      .map((node) => ({ node, rect: rotatedBounds(node.box, node.rotation) as Rect }))
      .sort((a, b) => (axis === 'x' ? a.rect.x - b.rect.x : a.rect.y - b.rect.y))
    if (items.length < 3) return
    const first = items[0].rect
    const last = items.at(-1)!.rect
    const span = axis === 'x' ? last.x + last.width - first.x : last.y + last.height - first.y
    const occupied = items.reduce((total, item) => total + (axis === 'x' ? item.rect.width : item.rect.height), 0)
    const gap = (span - occupied) / (items.length - 1)
    let cursor = axis === 'x' ? first.x : first.y
    moveBy(
      items.map(({ node, rect }) => {
        const delta = cursor - (axis === 'x' ? rect.x : rect.y)
        cursor += (axis === 'x' ? rect.width : rect.height) + gap
        return { node, dx: axis === 'x' ? delta : 0, dy: axis === 'y' ? delta : 0 }
      }),
      'Distribute layers'
    )
  }

  return (
    <>
      <Section title={`${layerIds.length} layers selected`}>
        <div className="flex flex-wrap gap-1" role="toolbar" aria-label="Align">
          {ALIGNMENTS.map((item) => (
            <IconButton key={item.id} label={item.label} onClick={() => align(item.id)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d={item.path} />
              </svg>
            </IconButton>
          ))}
        </div>
        <div className="flex gap-2">
          <Button variant="custom" size={null} type="button" disabled={nodes.length < 3} onClick={() => distribute('x')} className="h-8 flex-1 rounded-md border border-foreground/10 text-[11px] hover:bg-foreground/[0.05] disabled:opacity-40">
            Distribute horizontally
          </Button>
          <Button variant="custom" size={null} type="button" disabled={nodes.length < 3} onClick={() => distribute('y')} className="h-8 flex-1 rounded-md border border-foreground/10 text-[11px] hover:bg-foreground/[0.05] disabled:opacity-40">
            Distribute vertically
          </Button>
        </div>
        <div className="flex gap-2">
          {grouped ? (
            <Button variant="custom" size={null} type="button" onClick={() => api.getState().dispatch({ type: 'layers.ungroup', owner, layerIds })} className="h-8 flex-1 rounded-md border border-foreground/10 text-[11px] hover:bg-foreground/[0.05]">
              Ungroup (⇧⌘G)
            </Button>
          ) : (
            <Button variant="custom" size={null} type="button" onClick={() => api.getState().dispatch({ type: 'layers.group', owner, layerIds, groupId: crypto.randomUUID() })} className="h-8 flex-1 rounded-md border border-foreground/10 text-[11px] hover:bg-foreground/[0.05]">
              Group (⌘G)
            </Button>
          )}
          <Button variant="custom" size={null} type="button" onClick={() => api.getState().dispatch({ type: 'layers.delete', owner, layerIds })} className="h-8 flex-1 rounded-md border border-destructive/30 text-[11px] text-destructive hover:bg-destructive/10">
            Delete
          </Button>
        </div>
      </Section>
    </>
  )
}

/** Shown while a callout's source region is being picked. */
export function PickingHint(): React.JSX.Element {
  const api = useEditorApi()
  return (
    <Section title="Pick the magnified area">
      <p className="text-[11px] leading-relaxed text-muted-foreground">Drag a rectangle over the device screen on the canvas.</p>
      <Button variant="custom" size={null} type="button" onClick={() => api.getState().setPickingCallout(null)} className="h-8 w-full rounded-md border border-foreground/10 text-[11px]">
        Cancel
      </Button>
    </Section>
  )
}
