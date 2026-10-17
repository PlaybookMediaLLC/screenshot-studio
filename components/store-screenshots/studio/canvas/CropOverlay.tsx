'use client'

import * as React from 'react'
import { createPortal } from 'react-dom'
import type { LayerOwner } from '@/lib/store-screenshots/commands/schema'
import type { DeviceLayer, ImageFraming } from '@/lib/store-screenshots/document/schema'
import { clamp, rotatePoint, roundTo, type Point } from '@/lib/store-screenshots/engine/geometry'
import { nodeOutline } from '@/lib/store-screenshots/engine/hit-test'
import { screenImageRect, type SceneDevice } from '@/lib/store-screenshots/engine/scene'
import type { AssetResolver } from '../../render/SlideRender'
import { useEditorApi } from '../editor-store'
import { placeToolbar } from './toolbar-placement'

/**
 * Crop mode for a device screen: drag the screenshot, zoom it, then Done or
 * Cancel. The full image is ghosted outside the screen so the user sees
 * what is hidden. The toolbar sits outside the device so it never covers
 * the screen or the camera cutout.
 */

function customFramingFor(node: SceneDevice, mode: ImageFraming['mode']): ImageFraming {
  const centered = { scale: 1, offsetX: 0, offsetY: 0 }
  const contain = screenImageRect(node.screen.width, node.screen.height, node.imageAspect, { mode: 'fit', ...centered })
  const shown = screenImageRect(node.screen.width, node.screen.height, node.imageAspect, { mode, ...centered })
  return { mode: 'custom', scale: roundTo(shown.width / contain.width, 3), offsetX: 0, offsetY: 0 }
}

/** The custom framing that looks identical to the current fill or fit framing. */
export function toCustomFraming(node: SceneDevice): ImageFraming {
  return node.framing.mode === 'custom' ? node.framing : customFramingFor(node, node.framing.mode)
}

/** Props for the crop overlay. */
type CropOverlayProps = {
  node: SceneDevice
  layer: DeviceLayer
  owner: LayerOwner
  scale: number
  overlay: HTMLElement | null
  toScreen: (point: Point) => Point
  viewport: { width: number; height: number }
  resolveAsset: AssetResolver
}

/** Crop editing UI for one device. */
export function CropOverlay({ node, layer, owner, scale, overlay, toScreen, viewport, resolveAsset }: CropOverlayProps): React.JSX.Element {
  const api = useEditorApi()
  const [original] = React.useState<ImageFraming>(() => layer.image)
  const dragRef = React.useRef<{ pointerId: number; start: Point; framing: ImageFraming } | null>(null)
  const surfaceRef = React.useRef<HTMLDivElement>(null)
  const key = `crop:${layer.id}`

  const write = React.useCallback(
    (image: Partial<ImageFraming>) => {
      api.getState().dispatch({ type: 'layers.patch', owner, layerIds: [layer.id], patch: { image: { ...image } } }, { key })
    },
    [api, key, layer.id, owner]
  )

  React.useEffect(() => {
    if (layer.image.mode !== 'custom') write(toCustomFraming(node))
    surfaceRef.current?.focus({ preventScroll: true })
    // Convert once, when crop mode opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const done = () => api.getState().setCropping(null)
  const cancel = () => {
    api.getState().dispatch({ type: 'layers.patch', owner, layerIds: [layer.id], patch: { image: original } })
    api.getState().setCropping(null)
  }
  const zoomBy = (factor: number) => write({ mode: 'custom', scale: roundTo(clamp(layer.image.scale * factor, 0.25, 4), 3) })
  const nudge = (dx: number, dy: number) =>
    write({ mode: 'custom', offsetX: clamp(layer.image.offsetX + dx, -100, 100), offsetY: clamp(layer.image.offsetY + dy, -100, 100) })

  React.useEffect(() => {
    const surface = surfaceRef.current
    if (!surface) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      event.stopPropagation()
      zoomBy(Math.exp(-event.deltaY * 0.0015))
    }
    surface.addEventListener('wheel', onWheel, { passive: false })
    return () => surface.removeEventListener('wheel', onWheel)
  })

  const { box, screen, image } = node
  const src = node.assetId ? resolveAsset(node.assetId) : null
  const outline = nodeOutline(node).map(toScreen)
  const placement = placeToolbar(outline, { width: 360, height: 40 }, viewport)

  const toolbar = (
    <div
      role="toolbar"
      aria-label="Crop screenshot"
      data-store-crop-toolbar=""
      className="pointer-events-auto absolute z-40 flex h-10 items-center gap-0.5 rounded-full border border-foreground/15 bg-background/95 p-1 text-foreground shadow-lg backdrop-blur"
      style={{ left: placement.x, top: placement.y }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <button type="button" aria-label="Zoom screenshot out" title="Zoom out (−)" onClick={() => zoomBy(1 / 1.1)} className="flex size-8 items-center justify-center rounded-full hover:bg-foreground/[0.07]">
        −
      </button>
      <span className="min-w-12 text-center text-[11px] tabular-nums text-muted-foreground" aria-live="polite">
        {Math.round(layer.image.scale * 100)}%
      </span>
      <button type="button" aria-label="Zoom screenshot in" title="Zoom in (+)" onClick={() => zoomBy(1.1)} className="flex size-8 items-center justify-center rounded-full hover:bg-foreground/[0.07]">
        +
      </button>
      <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-foreground/10" />
      <button type="button" onClick={() => write(customFramingFor(node, 'fill'))} className="h-8 rounded-full px-2.5 text-[11px] hover:bg-foreground/[0.07]" title="Fill the screen">
        Fill
      </button>
      <button type="button" onClick={() => write({ mode: 'custom', scale: 1, offsetX: 0, offsetY: 0 })} className="h-8 rounded-full px-2.5 text-[11px] hover:bg-foreground/[0.07]" title="Show the whole screenshot">
        Fit
      </button>
      <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-foreground/10" />
      <button type="button" onClick={cancel} className="h-8 rounded-full px-2.5 text-[11px] text-muted-foreground hover:bg-foreground/[0.07]" title="Cancel (Esc)">
        Cancel
      </button>
      <button type="button" onClick={done} className="h-8 rounded-full bg-foreground px-3 text-[11px] font-medium text-background" title="Done (Enter)">
        Done
      </button>
    </div>
  )

  return (
    <>
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: box.x,
          top: box.y,
          width: box.width,
          height: box.height,
          transform: `rotate(${node.rotation}deg)`,
          zIndex: 25,
          pointerEvents: 'none',
        }}
      >
        {src ? (
          <img
            src={src}
            alt=""
            style={{
              position: 'absolute',
              left: screen.x + image.x,
              top: screen.y + image.y,
              width: image.width,
              height: image.height,
              maxWidth: 'none',
              opacity: 0.35,
              outline: `${2 / scale}px dashed rgba(59,130,246,0.9)`,
            }}
          />
        ) : null}
      </div>
      <div
        ref={surfaceRef}
        role="group"
        tabIndex={0}
        aria-label={`Crop ${layer.name}. Drag or use arrow keys to move, plus and minus to zoom, Enter to finish, Escape to cancel.`}
        aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Enter Escape"
        data-store-crop-surface={layer.id}
        style={{
          position: 'absolute',
          left: box.x + screen.x,
          top: box.y + screen.y,
          width: screen.width,
          height: screen.height,
          transform: `rotate(${node.rotation}deg)`,
          transformOrigin: `${box.width / 2 - screen.x}px ${box.height / 2 - screen.y}px`,
          cursor: 'move',
          touchAction: 'none',
          zIndex: 26,
          outline: `${2 / scale}px solid rgb(59,130,246)`,
          backgroundImage:
            'linear-gradient(to right, transparent 33.2%, rgba(255,255,255,0.5) 33.3%, transparent 33.4%, transparent 66.5%, rgba(255,255,255,0.5) 66.6%, transparent 66.7%), linear-gradient(to bottom, transparent 33.2%, rgba(255,255,255,0.5) 33.3%, transparent 33.4%, transparent 66.5%, rgba(255,255,255,0.5) 66.6%, transparent 66.7%)',
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.stopPropagation()
          event.currentTarget.setPointerCapture(event.pointerId)
          dragRef.current = { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, framing: layer.image }
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current
          if (!drag || drag.pointerId !== event.pointerId) return
          event.stopPropagation()
          const local = rotatePoint(
            { x: (event.clientX - drag.start.x) / scale, y: (event.clientY - drag.start.y) / scale },
            { x: 0, y: 0 },
            -node.rotation
          )
          write({
            mode: 'custom',
            offsetX: clamp(drag.framing.offsetX + (local.x / screen.width) * 100, -100, 100),
            offsetY: clamp(drag.framing.offsetY + (local.y / screen.height) * 100, -100, 100),
          })
        }}
        onPointerUp={(event) => {
          if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null
          api.getState().endGesture()
        }}
        onKeyDown={(event) => {
          event.stopPropagation()
          const step = event.shiftKey ? 5 : 1
          if (event.key === 'Escape') cancel()
          else if (event.key === 'Enter') done()
          else if (event.key === 'ArrowLeft') nudge(-step, 0)
          else if (event.key === 'ArrowRight') nudge(step, 0)
          else if (event.key === 'ArrowUp') nudge(0, -step)
          else if (event.key === 'ArrowDown') nudge(0, step)
          else if (event.key === '+' || event.key === '=') zoomBy(1.1)
          else if (event.key === '-' || event.key === '_') zoomBy(1 / 1.1)
          else return
          event.preventDefault()
        }}
      />
      {overlay ? createPortal(toolbar, overlay) : null}
    </>
  )
}
