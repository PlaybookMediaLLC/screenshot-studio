'use client'

import { shouldIgnoreEditorShortcut } from '@/lib/editor-shortcuts'

import * as React from 'react'
import { z } from 'zod'
import type { LayerOwner } from '@/lib/store-screenshots/commands/schema'
import type { CalloutLayer, DeviceLayer, LayerTransform, StoreLayer, TextLayer } from '@/lib/store-screenshots/document/schema'
import { clamp, rectCenter, rotatedBounds, unionRects, type Point, type Rect } from '@/lib/store-screenshots/engine/geometry'
import { hitTest, nodeOutline } from '@/lib/store-screenshots/engine/hit-test'
import { slidePointToDeviceImage, type Scene, type SceneDevice, type SceneNode } from '@/lib/store-screenshots/engine/scene'
import { snapRect, type SnapGuide } from '@/lib/store-screenshots/engine/snapping'
import { cn } from '@/lib/utils'
import { useRenderServices } from '../../render/RenderProvider'
import { useActiveScene } from '../active-scene'
import { SlideRender } from '../../render/SlideRender'
import { ownerLayers, useEditor, useEditorApi } from '../editor-store'
import { CropOverlay } from './CropOverlay'
import { InlineTextEditor } from './InlineTextEditor'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

/**
 * The editing canvas. The slide is drawn by the shared renderer at export
 * resolution and scaled into view; editor chrome (selection, handles,
 * guides, rulers) is drawn in screen space on top, so it is never part of
 * the slide and never exported. Pointer positions are converted to slide
 * pixels once, which keeps hit testing exact at every zoom level.
 */

/** Pixels kept free around the slide when fitting. */
const FIT_PADDING = 96
/** Screen pixels within which snapping engages. */
const SNAP_SCREEN_PX = 6

/** The selection handles that start a gesture: corner scale or rotate. */
const handleKindSchema = z.enum(['scale', 'rotate'])
type HandleKind = z.infer<typeof handleKindSchema>

type Gesture =
  | {
      kind: 'move'
      pointerId: number
      start: Point
      owner: LayerOwner
      items: Array<{ layerId: string; transform: LayerTransform; baseWidth: number }>
      bounds: Rect
      others: Rect[]
      moved: boolean
    }
  | { kind: 'scale'; pointerId: number; owner: LayerOwner; layerId: string; center: Point; startDistance: number; transform: LayerTransform }
  | { kind: 'rotate'; pointerId: number; owner: LayerOwner; layerId: string; center: Point; startAngle: number; transform: LayerTransform }
  | { kind: 'pan'; pointerId: number; start: Point; pan: Point }

function useElementSize(ref: React.RefObject<HTMLElement | null>): { width: number; height: number } {
  const [size, setSize] = React.useState({ width: 0, height: 0 })
  React.useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return size
}

function rulerStep(scale: number): number {
  return [10, 20, 50, 100, 200, 500, 1000].find((step) => step * scale >= 56) ?? 1000
}

function Rulers({ origin, scale, size, viewport }: { origin: Point; scale: number; size: { width: number; height: number }; viewport: { width: number; height: number } }) {
  const step = rulerStep(scale)
  const ticks = (length: number) => Array.from({ length: Math.floor(length / step) + 1 }, (_, index) => index * step)
  return (
    <>
      <div aria-hidden="true" className="absolute left-0 top-0 z-30 h-5 border-b border-foreground/10 bg-background/90 text-[9px] text-muted-foreground" style={{ width: viewport.width }}>
        {ticks(size.width).map((value) => (
          <span key={value} className="absolute top-0 h-full border-l border-foreground/20 pl-0.5" style={{ left: origin.x + value * scale }}>
            {value}
          </span>
        ))}
      </div>
      <div aria-hidden="true" className="absolute left-0 top-0 z-30 w-5 border-r border-foreground/10 bg-background/90 text-[9px] text-muted-foreground" style={{ height: viewport.height }}>
        {ticks(size.height).map((value) => (
          <span key={value} className="absolute left-0 w-full border-t border-foreground/20 [writing-mode:vertical-rl]" style={{ top: origin.y + value * scale }}>
            {value}
          </span>
        ))}
      </div>
    </>
  )
}

function polygonPoints(points: Point[]): string {
  return points.map((point) => `${point.x},${point.y}`).join(' ')
}

function CalloutRegionPicker({
  device,
  callout,
  owner,
  scale,
}: {
  device: SceneDevice
  callout: CalloutLayer
  owner: LayerOwner
  scale: number
}): React.JSX.Element {
  const api = useEditorApi()
  const [draft, setDraft] = React.useState<{ start: Point; end: Point } | null>(null)
  const surfaceToSlide = (event: React.PointerEvent<HTMLDivElement>): Point => {
    const rect = event.currentTarget.parentElement!.getBoundingClientRect()
    return { x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale }
  }
  const region = draft
    ? (() => {
        const a = slidePointToDeviceImage(device, draft.start)
        const b = slidePointToDeviceImage(device, draft.end)
        const x = clamp(Math.min(a.x, b.x), 0, 1)
        const y = clamp(Math.min(a.y, b.y), 0, 1)
        return { x, y, width: clamp(Math.abs(a.x - b.x), 0.01, 1 - x), height: clamp(Math.abs(a.y - b.y), 0.01, 1 - y) }
      })()
    : callout.region
  const { box, screen, image } = device
  return (
    <div
      role="group"
      aria-label="Drag over the screenshot to choose the area to magnify"
      data-store-callout-picker={callout.id}
      style={{
        position: 'absolute',
        left: box.x,
        top: box.y,
        width: box.width,
        height: box.height,
        transform: `rotate(${device.rotation}deg)`,
        zIndex: 27,
        cursor: 'crosshair',
        touchAction: 'none',
      }}
      onPointerDown={(event) => {
        event.stopPropagation()
        event.currentTarget.setPointerCapture(event.pointerId)
        const point = surfaceToSlide(event)
        setDraft({ start: point, end: point })
      }}
      onPointerMove={(event) => {
        if (!draft) return
        event.stopPropagation()
        setDraft({ ...draft, end: surfaceToSlide(event) })
      }}
      onPointerUp={(event) => {
        event.stopPropagation()
        if (draft && region.width > 0.01) {
          api.getState().dispatch({ type: 'layers.patch', owner, layerIds: [callout.id], patch: { props: { region } } })
        }
        setDraft(null)
        api.getState().setPickingCallout(null)
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: screen.x + image.x + region.x * image.width,
          top: screen.y + image.y + region.y * image.height,
          width: region.width * image.width,
          height: region.height * image.height,
          outline: `${2 / scale}px solid #F59E0B`,
          background: 'rgba(245,158,11,0.15)',
        }}
      />
    </div>
  )
}

/** Props for the canvas. */
type EditorCanvasProps = {
  /** Files dropped or chosen for a device (replace) or the canvas (import). */
  onFiles: (files: File[], device: { slideId: string; layerId: string } | null) => void
}

/** The editing canvas for the active slide. */
export function EditorCanvas({ onFiles }: EditorCanvasProps): React.JSX.Element {
  const api = useEditorApi()
  const document = useEditor((state) => state.document)
  const locale = useEditor((state) => state.locale)
  const targetId = useEditor((state) => state.targetId)
  const zoom = useEditor((state) => state.zoom)
  const pan = useEditor((state) => state.pan)
  const view = useEditor((state) => state.view)
  const selection = useEditor((state) => state.selection)
  const editingText = useEditor((state) => state.editingText)
  const croppingLayerId = useEditor((state) => state.croppingLayerId)
  const pickingCalloutId = useEditor((state) => state.pickingCalloutId)
  const overrideMode = useEditor((state) => state.targetOverrideMode)
  const { resolveAsset } = useRenderServices()

  const { scene, slide, size, target } = useActiveScene()

  const viewportRef = React.useRef<HTMLDivElement>(null)
  const viewport = useElementSize(viewportRef)
  const [overlay, setOverlay] = React.useState<HTMLDivElement | null>(null)
  const gestureRef = React.useRef<Gesture | null>(null)
  const [guides, setGuides] = React.useState<SnapGuide[]>([])
  const [hoverId, setHoverId] = React.useState<string | null>(null)
  const [caretPoint, setCaretPoint] = React.useState<Point | null>(null)
  const [spaceHeld, setSpaceHeld] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const pendingDeviceRef = React.useRef<{ slideId: string; layerId: string } | null>(null)

  const fit = Math.max(0.03, Math.min((viewport.width - FIT_PADDING) / size.width, (viewport.height - FIT_PADDING) / size.height))
  const scale = zoom ?? fit
  const origin = {
    x: (viewport.width - size.width * scale) / 2 + (zoom === null ? 0 : pan.x),
    y: (viewport.height - size.height * scale) / 2 + (zoom === null ? 0 : pan.y),
  }
  const toScreen = React.useCallback((point: Point): Point => ({ x: origin.x + point.x * scale, y: origin.y + point.y * scale }), [origin.x, origin.y, scale])
  const toSlide = (clientX: number, clientY: number): Point => {
    const rect = viewportRef.current!.getBoundingClientRect()
    return { x: (clientX - rect.left - origin.x) / scale, y: (clientY - rect.top - origin.y) / scale }
  }

  const ownerFor = React.useCallback(
    (node: SceneNode): LayerOwner =>
      node.panorama && scene?.panorama ? { kind: 'panorama', id: scene.panorama.id } : { kind: 'slide', id: slide.id },
    [scene?.panorama, slide.id]
  )
  const baseWidthFor = (node: SceneNode) => (node.panorama && scene?.panorama ? size.width * scene.panorama.count : size.width)
  const effectiveTransform = (owner: LayerOwner, layer: StoreLayer): LayerTransform =>
    overrideMode && owner.kind === 'slide'
      ? { ...layer.transform, ...(slide.targetOverrides[targetId]?.[layer.id] ?? {}) }
      : layer.transform
  const writeTransforms = (owner: LayerOwner, transforms: Record<string, Partial<LayerTransform>>, key: string) => {
    api.getState().dispatch(
      { type: 'layers.setTransforms', owner, transforms, targetId: overrideMode && owner.kind === 'slide' ? targetId : null },
      { key }
    )
  }

  React.useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !shouldIgnoreEditorShortcut(event)) {
        setSpaceHeld(true)
      }
    }
    const up = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpaceHeld(false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  React.useEffect(() => {
    const element = viewportRef.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const state = api.getState()
      const rect = element.getBoundingClientRect()
      const currentScale = state.zoom ?? fit
      const currentOrigin = {
        x: (rect.width - size.width * currentScale) / 2 + (state.zoom === null ? 0 : state.pan.x),
        y: (rect.height - size.height * currentScale) / 2 + (state.zoom === null ? 0 : state.pan.y),
      }
      if (event.ctrlKey || event.metaKey) {
        const nextScale = clamp(currentScale * Math.exp(-event.deltaY * 0.002), 0.1, 4)
        const pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top }
        const slidePoint = { x: (pointer.x - currentOrigin.x) / currentScale, y: (pointer.y - currentOrigin.y) / currentScale }
        const centered = { x: (rect.width - size.width * nextScale) / 2, y: (rect.height - size.height * nextScale) / 2 }
        state.setZoom(nextScale)
        state.setPan({ x: pointer.x - slidePoint.x * nextScale - centered.x, y: pointer.y - slidePoint.y * nextScale - centered.y })
        return
      }
      if (state.zoom === null) {
        state.setZoom(currentScale)
        state.setPan({ x: -event.deltaX, y: -event.deltaY })
        return
      }
      state.setPan({ x: state.pan.x - event.deltaX, y: state.pan.y - event.deltaY })
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [api, fit, size.width, size.height])

  if (!scene) return <div ref={viewportRef} className="flex-1" />

  const selectedIds = new Set(selection?.layerIds ?? [])
  const selectedNodes = scene.nodes.filter((node) => selectedIds.has(node.layerId) && ownerFor(node).kind === selection?.owner.kind)
  const hoverNode = hoverId && !selectedIds.has(hoverId) ? scene.nodes.find((node) => node.layerId === hoverId) : undefined
  const editingNode = editingText ? scene.nodes.find((node) => node.layerId === editingText.layerId && node.type === 'text') : undefined
  const editingLayer = editingText
    ? (ownerLayers(document, editingText.owner).find((layer) => layer.id === editingText.layerId) as TextLayer | undefined)
    : undefined
  const croppingNode = croppingLayerId ? (scene.nodes.find((node) => node.layerId === croppingLayerId && node.type === 'device') as SceneDevice | undefined) : undefined
  const croppingOwner = croppingNode ? ownerFor(croppingNode) : null
  const croppingLayer = croppingNode && croppingOwner
    ? (ownerLayers(document, croppingOwner).find((layer) => layer.id === croppingLayerId) as DeviceLayer | undefined)
    : undefined
  const pickingLayer = pickingCalloutId
    ? (slide.layers.find((layer) => layer.id === pickingCalloutId && layer.type === 'callout') as CalloutLayer | undefined)
    : undefined
  const pickingDevice = pickingLayer
    ? (scene.nodes.find((node) => node.layerId === pickingLayer.deviceLayerId && node.type === 'device') as SceneDevice | undefined)
    : undefined
  const hiddenLayerIds = editingNode ? new Set([editingNode.layerId]) : undefined
  const single = selectedNodes.length === 1 && !selectedNodes[0].locked && !editingNode && !croppingNode ? selectedNodes[0] : null

  const startMove = (event: React.PointerEvent, owner: LayerOwner, layerIds: string[], start: Point) => {
    const layers = ownerLayers(document, owner)
    const moving = scene.nodes.filter((node) => layerIds.includes(node.layerId) && !node.locked)
    if (moving.length === 0) return
    gestureRef.current = {
      kind: 'move',
      pointerId: event.pointerId,
      start,
      owner,
      items: moving.map((node) => ({
        layerId: node.layerId,
        transform: effectiveTransform(owner, layers.find((layer) => layer.id === node.layerId)!),
        baseWidth: baseWidthFor(node),
      })),
      bounds: unionRects(moving.map((node) => rotatedBounds(node.box, node.rotation)))!,
      others: scene.nodes.filter((node) => !layerIds.includes(node.layerId)).map((node) => rotatedBounds(node.box, node.rotation)),
      moved: false,
    }
  }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest('[data-store-text-toolbar],[data-store-crop-toolbar],[data-store-inline-editor],[data-store-crop-surface],[data-store-callout-picker],[data-store-canvas-control]')) return
    viewportRef.current?.focus({ preventScroll: true })
    if (event.button === 1 || spaceHeld) {
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      const current = api.getState()
      if (current.zoom === null) current.setZoom(scale)
      gestureRef.current = { kind: 'pan', pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, pan: current.zoom === null ? { x: 0, y: 0 } : pan }
      return
    }
    if (event.button !== 0) return
    if (croppingLayerId) {
      api.getState().setCropping(null)
      return
    }
    if (editingText) api.getState().stopTextEdit()
    const point = toSlide(event.clientX, event.clientY)
    const hit = hitTest(scene, point)
    if (!hit) {
      api.getState().clearSelection()
      return
    }
    const owner = ownerFor(hit)
    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      api.getState().selectLayers(owner, [hit.layerId], 'toggle', { deep: event.altKey })
      return
    }
    const state = api.getState()
    const alreadySelected = state.selection?.owner.id === owner.id && state.selection.layerIds.includes(hit.layerId)
    if (!alreadySelected) state.selectLayers(owner, [hit.layerId], 'replace', { deep: event.altKey })
    event.currentTarget.setPointerCapture(event.pointerId)
    startMove(event, owner, api.getState().selection?.layerIds ?? [hit.layerId], point)
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current
    if (!gesture) {
      if (event.buttons === 0 && !editingNode && !croppingNode) {
        const hit = hitTest(scene, toSlide(event.clientX, event.clientY))
        const id = hit?.layerId ?? null
        if (id !== hoverId) setHoverId(id)
      }
      return
    }
    if (gesture.pointerId !== event.pointerId) return
    if (gesture.kind === 'pan') {
      api.getState().setPan({ x: gesture.pan.x + event.clientX - gesture.start.x, y: gesture.pan.y + event.clientY - gesture.start.y })
      return
    }
    const point = toSlide(event.clientX, event.clientY)
    if (gesture.kind === 'move') {
      let dx = point.x - gesture.start.x
      let dy = point.y - gesture.start.y
      if (!gesture.moved && Math.hypot(dx, dy) * scale < 3) return
      gesture.moved = true
      if (event.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0
        else dx = 0
      }
      const snapping = view.snapping && !(event.metaKey || event.ctrlKey)
      const snapped = snapping
        ? snapRect({ ...gesture.bounds, x: gesture.bounds.x + dx, y: gesture.bounds.y + dy }, size, gesture.others, SNAP_SCREEN_PX / scale, view.safeArea ? scene.safeArea : undefined)
        : { dx: 0, dy: 0, guides: [] }
      dx += snapped.dx
      dy += snapped.dy
      setGuides(view.guides ? snapped.guides : [])
      const transforms: Record<string, Partial<LayerTransform>> = {}
      for (const item of gesture.items) {
        transforms[item.layerId] = {
          offsetX: clamp(item.transform.offsetX + (dx / item.baseWidth) * 100, -200, 200),
          offsetY: clamp(item.transform.offsetY + (dy / size.height) * 100, -200, 200),
        }
      }
      writeTransforms(gesture.owner, transforms, `move:${gesture.items.map((item) => item.layerId).join(',')}`)
      return
    }
    if (gesture.kind === 'scale') {
      const distance = Math.max(1, Math.hypot(point.x - gesture.center.x, point.y - gesture.center.y))
      const next = clamp(Math.round(gesture.transform.scale * (distance / gesture.startDistance) * 1000) / 1000, 0.1, 5)
      writeTransforms(gesture.owner, { [gesture.layerId]: { scale: next } }, `scale:${gesture.layerId}`)
      return
    }
    const angle = (Math.atan2(point.y - gesture.center.y, point.x - gesture.center.x) * 180) / Math.PI
    let rotation = gesture.transform.rotation + angle - gesture.startAngle
    rotation = ((((rotation + 180) % 360) + 360) % 360) - 180
    rotation = event.shiftKey ? Math.round(rotation / 15) * 15 : Math.round(rotation * 10) / 10
    writeTransforms(gesture.owner, { [gesture.layerId]: { rotation } }, `rotate:${gesture.layerId}`)
  }

  const endGesture = (event: React.PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    gestureRef.current = null
    setGuides([])
    api.getState().endGesture()
  }

  const startHandle = (event: React.PointerEvent, node: SceneNode, kind: HandleKind) => {
    event.stopPropagation()
    event.preventDefault()
    viewportRef.current?.setPointerCapture(event.pointerId)
    const owner = ownerFor(node)
    const layer = ownerLayers(document, owner).find((item) => item.id === node.layerId)
    if (!layer) return
    const center = rectCenter(node.box)
    const point = toSlide(event.clientX, event.clientY)
    const transform = effectiveTransform(owner, layer)
    gestureRef.current =
      kind === 'scale'
        ? { kind, pointerId: event.pointerId, owner, layerId: node.layerId, center, startDistance: Math.max(1, Math.hypot(point.x - center.x, point.y - center.y)), transform }
        : { kind, pointerId: event.pointerId, owner, layerId: node.layerId, center, startAngle: (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI, transform }
  }

  const onDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const hit = hitTest(scene, toSlide(event.clientX, event.clientY))
    if (!hit) return
    const owner = ownerFor(hit)
    if (hit.type === 'text') {
      setCaretPoint({ x: event.clientX, y: event.clientY })
      api.getState().startTextEdit(owner, hit.layerId)
    } else if (hit.type === 'device') {
      api.getState().selectLayers(owner, [hit.layerId], 'replace', { deep: true })
      if (hit.assetId) api.getState().setCropping(hit.layerId)
    } else if (hit.type === 'callout') {
      api.getState().selectLayers(owner, [hit.layerId], 'replace', { deep: true })
      api.getState().setPickingCallout(hit.layerId)
    } else if (hit.type === 'annotation') {
      api.getState().selectLayers(owner, [hit.layerId], 'replace', { deep: true })
      window.requestAnimationFrame(() => globalThis.document.querySelector<HTMLInputElement>('[data-inspector-focus="annotation-text"]')?.focus())
    }
  }

  const singleOutline = single ? nodeOutline(single).map(toScreen) : null
  const rotateHandle = singleOutline
    ? (() => {
        const [tl, tr, , bl] = singleOutline
        const mid = { x: (tl.x + tr.x) / 2, y: (tl.y + tr.y) / 2 }
        const edge = { x: tl.x - bl.x, y: tl.y - bl.y }
        const length = Math.hypot(edge.x, edge.y) || 1
        return { x: mid.x + (edge.x / length) * 28, y: mid.y + (edge.y / length) * 28, mid }
      })()
    : null

  return (
    <div
      ref={viewportRef}
      tabIndex={0}
      role="application"
      aria-label={`Canvas for ${slide.name}. Click to select, drag to move, double-click text to edit.`}
      aria-roledescription="slide canvas"
      data-store-canvas=""
      className={cn(
        'relative min-h-0 flex-1 overflow-hidden bg-foreground/[0.03] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground/20',
        spaceHeld ? 'cursor-grab' : hoverNode ? 'cursor-move' : 'cursor-default'
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
      onPointerLeave={() => setHoverId(null)}
      onDoubleClick={onDoubleClick}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }}
      onDrop={(event) => {
        const files = Array.from(event.dataTransfer.files)
        if (files.length === 0) return
        event.preventDefault()
        const hit = hitTest(scene, toSlide(event.clientX, event.clientY), true)
        onFiles(files, hit?.type === 'device' && !hit.panorama ? { slideId: slide.id, layerId: hit.layerId } : null)
      }}
    >
      <div
        data-store-canvas-slide=""
        className="absolute shadow-2xl ring-1 ring-foreground/10"
        style={{
          left: origin.x,
          top: origin.y,
          width: size.width,
          height: size.height,
          transform: `scale(${scale})`,
          transformOrigin: '0 0',
        }}
      >
        <SlideRender scene={scene} resolveAsset={resolveAsset} hiddenLayerIds={hiddenLayerIds} />
        {view.grid ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage: `linear-gradient(to right, rgba(59,130,246,0.18) ${1 / scale}px, transparent ${1 / scale}px), linear-gradient(to bottom, rgba(59,130,246,0.18) ${1 / scale}px, transparent ${1 / scale}px)`,
              backgroundSize: `${size.width / 20}px ${size.width / 20}px`,
            }}
          />
        ) : null}
        {view.safeArea ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute"
            style={{
              left: scene.safeArea.x,
              top: scene.safeArea.y,
              width: scene.safeArea.width,
              height: scene.safeArea.height,
              outline: `${1.5 / scale}px dashed rgba(236,72,153,0.8)`,
            }}
          />
        ) : null}
        {editingNode && editingLayer && editingText ? (
          <InlineTextEditor
            key={`${editingText.layerId}:${locale}`}
            node={editingNode as Extract<SceneNode, { type: 'text' }>}
            layer={editingLayer}
            owner={editingText.owner}
            slideId={slide.id}
            locale={locale}
            sourceLocale={document.localization.sourceLocale}
            overlay={overlay}
            toScreen={toScreen}
            viewport={viewport}
            palette={document.theme.palette}
            caretPoint={caretPoint}
          />
        ) : null}
        {croppingNode && croppingLayer && croppingOwner ? (
          <CropOverlay
            key={croppingNode.layerId}
            node={croppingNode}
            layer={croppingLayer}
            owner={croppingOwner}
            scale={scale}
            overlay={overlay}
            toScreen={toScreen}
            viewport={viewport}
            resolveAsset={resolveAsset}
          />
        ) : null}
        {pickingLayer && pickingDevice ? (
          <CalloutRegionPicker device={pickingDevice} callout={pickingLayer} owner={{ kind: 'slide', id: slide.id }} scale={scale} />
        ) : null}
      </div>

      <div ref={setOverlay} className="pointer-events-none absolute inset-0 z-20">
        <svg className="absolute inset-0" width={viewport.width} height={viewport.height} aria-hidden="true">
          {hoverNode ? (
            <polygon points={polygonPoints(nodeOutline(hoverNode).map(toScreen))} fill="none" stroke="var(--canvas-selection, #3B82F6)" strokeOpacity="0.55" strokeWidth="1" />
          ) : null}
          {selectedNodes.map((node) => (
            <polygon
              key={node.layerId}
              data-store-selection-outline={node.layerId}
              points={polygonPoints(nodeOutline(node).map(toScreen))}
              fill="none"
              stroke="var(--canvas-selection, #3B82F6)"
              strokeWidth="1.5"
              strokeDasharray={node.locked ? '4 3' : undefined}
            />
          ))}
          {rotateHandle ? <line x1={rotateHandle.mid.x} y1={rotateHandle.mid.y} x2={rotateHandle.x} y2={rotateHandle.y} stroke="var(--canvas-selection, #3B82F6)" strokeWidth="1" /> : null}
          {guides.map((guide, guideIndex) =>
            guide.axis === 'x' ? (
              <line key={guideIndex} x1={toScreen({ x: guide.position, y: 0 }).x} x2={toScreen({ x: guide.position, y: 0 }).x} y1={toScreen({ x: 0, y: guide.from }).y} y2={toScreen({ x: 0, y: guide.to }).y} stroke="#EC4899" strokeWidth="1" />
            ) : (
              <line key={guideIndex} y1={toScreen({ x: 0, y: guide.position }).y} y2={toScreen({ x: 0, y: guide.position }).y} x1={toScreen({ x: guide.from, y: 0 }).x} x2={toScreen({ x: guide.to, y: 0 }).x} stroke="#EC4899" strokeWidth="1" />
            )
          )}
        </svg>
        {single && singleOutline
          ? singleOutline.map((corner, cornerIndex) => (
              <Button variant="custom" size={null}
                key={cornerIndex}
                type="button"
                data-store-canvas-control="resize"
                aria-label={`Resize ${single.name}`}
                title={`Resize ${single.name}`}
                onPointerDown={(event) => startHandle(event, single, handleKindSchema.enum.scale)}
                className="pointer-events-auto absolute size-3 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize rounded-[3px] border-2 border-[var(--canvas-selection,#3B82F6)] bg-white shadow-sm before:absolute before:-inset-2.5 before:content-['']"
                style={{ left: corner.x, top: corner.y }}
              />
            ))
          : null}
        {single && rotateHandle ? (
          <Button variant="custom" size={null}
            type="button"
            data-store-canvas-control="rotate"
            aria-label={`Rotate ${single.name}`}
            title={`Rotate ${single.name} (hold Shift for 15° steps)`}
            onPointerDown={(event) => startHandle(event, single, handleKindSchema.enum.rotate)}
            className="pointer-events-auto absolute flex size-6 -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center rounded-full border-2 border-[var(--canvas-selection,#3B82F6)] bg-white text-[var(--canvas-selection,#3B82F6)] shadow-sm"
            style={{ left: rotateHandle.x, top: rotateHandle.y }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <path d="M21.5 2v6h-6" />
              <path d="M21.34 13.72A10 10 0 1 1 18.57 4.62L21.5 8" />
            </svg>
          </Button>
        ) : null}
        {scene.nodes
          .filter((node): node is SceneDevice => node.type === 'device' && !node.assetId && !node.panorama)
          .map((node) => {
            const center = toScreen(rectCenter(node.box))
            return (
              <Button variant="custom" size={null}
                key={node.layerId}
                type="button"
                data-store-canvas-control="add-screenshot"
                onClick={() => {
                  pendingDeviceRef.current = { slideId: slide.id, layerId: node.layerId }
                  fileInputRef.current?.click()
                }}
                className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-foreground/15 bg-background px-3 py-1.5 text-[11px] font-medium shadow-md hover:bg-foreground/[0.05]"
                style={{ left: center.x, top: center.y }}
              >
                Add screenshot
              </Button>
            )
          })}
        {view.rulers ? <Rulers origin={origin} scale={scale} size={size} viewport={viewport} /> : null}
      </div>

      <div className="pointer-events-none absolute left-3 top-3 z-30 flex items-center gap-2 text-[11px] text-muted-foreground" style={{ marginTop: view.rulers ? 20 : 0, marginLeft: view.rulers ? 20 : 0 }}>
        <span className="rounded bg-background/80 px-1.5 py-0.5 tabular-nums">
          {target.shortName} · {size.width} × {size.height}
        </span>
        {overrideMode ? <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-700 dark:text-amber-300">Editing this size only</span> : null}
        {locale !== document.localization.sourceLocale ? <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-sky-700 dark:text-sky-300">{locale}</span> : null}
      </div>
      <CanvasZoomBar scale={scale} fitted={zoom === null} />
      <Input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          if (files.length) onFiles(files.slice(0, 1), pendingDeviceRef.current)
          event.currentTarget.value = ''
        }}
      />
      <SceneAnnouncer scene={scene} />
    </div>
  )
}

function SceneAnnouncer({ scene }: { scene: Scene }): React.JSX.Element {
  const announcement = useEditor((state) => state.announcement)
  return (
    <p className="sr-only" role="status" aria-live="polite">
      {announcement}
      {scene.hidden.some((item) => item.reason === 'layout') ? ' Some devices are hidden by this layout.' : ''}
    </p>
  )
}

/** Zoom controls pinned to the canvas corner. */
function CanvasZoomBar({ scale, fitted }: { scale: number; fitted: boolean }): React.JSX.Element {
  const api = useEditorApi()
  const step = (factor: number) => {
    api.getState().setZoom(scale * factor)
  }
  const button = 'flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-xs hover:bg-foreground/[0.07]'
  return (
    <div data-store-canvas-control="zoom" className="absolute bottom-3 right-3 z-30 flex items-center gap-0.5 rounded-lg border border-foreground/10 bg-background/95 p-0.5 shadow-sm" onPointerDown={(event) => event.stopPropagation()}>
      <Button variant="custom" size={null} type="button" className={button} aria-label="Zoom out" title="Zoom out (⌘−)" onClick={() => step(1 / 1.25)}>
        −
      </Button>
      <Button variant="custom" size={null} type="button" className={cn(button, 'min-w-12 tabular-nums')} aria-label="Fit slide to screen" title="Fit to screen (⌘0)" onClick={() => api.getState().setZoom(null)}>
        {fitted ? 'Fit' : `${Math.round(scale * 100)}%`}
      </Button>
      <Button variant="custom" size={null} type="button" className={button} aria-label="Zoom in" title="Zoom in (⌘+)" onClick={() => step(1.25)}>
        +
      </Button>
      <Button variant="custom" size={null}
        type="button"
        className={button}
        aria-label="Actual size"
        title="Actual size (⌘1)"
        onClick={() => {
          api.getState().setZoom(1)
          api.getState().setPan({ x: 0, y: 0 })
        }}
      >
        1:1
      </Button>
    </div>
  )
}
