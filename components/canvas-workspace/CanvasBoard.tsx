'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ContextMenu } from 'radix-ui'
import { artboardRect, boundsOf, type Artboard, type WorkspaceRect } from '@/lib/canvas/document'
import { hitTest, marqueeSelect, snapMove, snapToGrid, type SnapGuide } from '@/lib/canvas/layout'
import {
  intersects,
  panBy,
  previewWidthFor,
  rectFromPoints,
  rectToScreen,
  screenToWorld,
  visibleWorldRect,
  wheelZoomFactor,
  zoomAt,
  type Point,
} from '@/lib/canvas/viewport'
import { useCanvasUi, useCanvasViewport } from '@/lib/canvas/ui-store'
import { ARTBOARD_PRESETS, artboardPresetSchema } from '@/lib/canvas/recipes'
import { cn } from '@/lib/utils'
import { ArtboardPreview } from './ArtboardPreview'
import type { CanvasActions } from './use-canvas-actions'

/** Resize handles: corners and edges, by the edges they move. */
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
type Handle = (typeof HANDLES)[number]

type Gesture =
  | { kind: 'pan'; pointerId: number; start: Point; panX: number; panY: number }
  | {
      kind: 'move'
      pointerId: number
      start: Point
      ids: string[]
      moved: boolean
      hit: string
      additive: boolean
      wasSelected: boolean
    }
  | { kind: 'marquee'; pointerId: number; start: Point; additive: boolean; base: string[] }
  | {
      kind: 'resize'
      pointerId: number
      id: string
      handle: Handle
      start: Point
      rect: WorkspaceRect
      keepRatio: boolean
    }

const DRAG_THRESHOLD = 3
const menuItem =
  'flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[disabled]:opacity-50'

/**
 * The infinite board: a camera over finite artboards. Every artboard draws
 * as a cached render except the one the native editor holds, which
 * `editor` overlays at the artboard's exact screen rectangle. Drags,
 * resizes and marquees are transient until the pointer is released, so
 * each becomes one undo step.
 */
export function CanvasBoard({
  artboards,
  actions,
  canEdit,
  editor,
  onDropFiles,
}: {
  artboards: Artboard[]
  actions: CanvasActions
  canEdit: boolean
  editor: ReactNode
  onDropFiles: (files: File[], at: Point) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const viewport = useCanvasViewport((state) => state.viewport)
  const screen = useCanvasViewport((state) => state.screen)
  const setViewport = useCanvasViewport((state) => state.setViewport)
  const setScreen = useCanvasViewport((state) => state.setScreen)
  const setMoving = useCanvasViewport((state) => state.setMoving)
  const selection = useCanvasUi((state) => state.selection)
  const activeId = useCanvasUi((state) => state.activeId)
  const tool = useCanvasUi((state) => state.tool)
  const grid = useCanvasUi((state) => state.grid)
  const renamingId = useCanvasUi((state) => state.renamingId)
  const [gesture, setGesture] = useState<Gesture | null>(null)
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null)
  const [marquee, setMarquee] = useState<WorkspaceRect | null>(null)
  const [guides, setGuides] = useState<SnapGuide[]>([])
  const [resizing, setResizing] = useState<{ id: string; rect: WorkspaceRect } | null>(null)
  const [menuTarget, setMenuTarget] = useState<{ id: string | null; at: Point }>({
    id: null,
    at: { x: 0, y: 0 },
  })
  const [spaceHeld, setSpaceHeld] = useState(false)
  const settledZoom = useCanvasViewport((state) => state.settledZoom)
  const movingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pointers = useRef(new Map<number, Point>())
  const pinch = useRef<{ distance: number; mid: Point } | null>(null)

  const items = useMemo(
    () =>
      artboards.map((artboard) => ({ id: artboard.id, rect: artboardRect(artboard), artboard })),
    [artboards]
  )

  // The board's size on screen, for fitting and culling.
  useEffect(() => {
    const element = container.current
    if (!element) return
    const measure = () => setScreen({ width: element.clientWidth, height: element.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [setScreen])

  /** Camera changes mark the board as moving until it settles, so expensive work waits. */
  const moveCamera = useCallback(
    (next: Parameters<typeof setViewport>[0]) => {
      setViewport(next)
      setMoving(true)
      clearTimeout(movingTimer.current)
      movingTimer.current = setTimeout(() => setMoving(false), 160)
    },
    [setViewport, setMoving]
  )
  useEffect(() => () => clearTimeout(movingTimer.current), [])

  const local = useCallback((event: { clientX: number; clientY: number }): Point => {
    const box = container.current!.getBoundingClientRect()
    return { x: event.clientX - box.left, y: event.clientY - box.top }
  }, [])

  // Wheel: pinch or ⌘/Ctrl-wheel zooms at the pointer; plain wheel and two-finger scroll pan.
  useEffect(() => {
    const element = container.current
    if (!element) return
    const wheel = (event: WheelEvent) => {
      if ((event.target as HTMLElement).closest('[data-board-ignore-wheel]')) return
      event.preventDefault()
      const { viewport } = useCanvasViewport.getState()
      if (event.ctrlKey || event.metaKey) {
        moveCamera(
          zoomAt(
            viewport,
            local(event),
            viewport.zoom * wheelZoomFactor(event.deltaY, event.deltaMode)
          )
        )
      } else {
        const scale = event.deltaMode === 1 ? 16 : 1
        moveCamera(panBy(viewport, -event.deltaX * scale, -event.deltaY * scale))
      }
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [local, moveCamera])

  // Holding Space pans with the pointer, like most design tools.
  useEffect(() => {
    const editable = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      Boolean(target.closest('input,textarea,select,[contenteditable="true"]'))
    const down = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !editable(event.target) && !event.repeat) setSpaceHeld(true)
    }
    const up = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpaceHeld(false)
    }
    const blur = () => setSpaceHeld(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])

  const threshold = 6 / viewport.zoom
  const gridSize = grid.snap ? grid.size : null

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement
    if (target.closest('[data-canvas-editor],[data-board-control]')) return
    pointers.current.set(event.pointerId, local(event))
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [Point, Point]
      pinch.current = {
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      }
      setGesture(null)
      setDrag(null)
      setMarquee(null)
      return
    }
    if (event.button === 2) return
    container.current?.focus({ preventScroll: true })
    const point = local(event)
    if (event.button === 1 || tool === 'hand' || spaceHeld) {
      event.currentTarget.setPointerCapture(event.pointerId)
      setGesture({
        kind: 'pan',
        pointerId: event.pointerId,
        start: point,
        panX: viewport.panX,
        panY: viewport.panY,
      })
      return
    }
    const handle = target.closest<HTMLElement>('[data-resize-handle]')?.dataset.resizeHandle as
      Handle | undefined
    const ui = useCanvasUi.getState()
    if (handle && canEdit && ui.selection.length === 1) {
      const artboard = items.find((item) => item.id === ui.selection[0])
      if (artboard) {
        event.currentTarget.setPointerCapture(event.pointerId)
        setGesture({
          kind: 'resize',
          pointerId: event.pointerId,
          id: artboard.id,
          handle,
          start: screenToWorld(viewport, point),
          rect: artboard.rect,
          keepRatio: event.shiftKey,
        })
        return
      }
    }
    const world = screenToWorld(viewport, point)
    const labelId = target.closest<HTMLElement>('[data-artboard-label]')?.dataset.artboardLabel
    const hit =
      labelId ??
      hitTest(
        items.filter((item) => item.id !== activeId),
        world
      )
    if (hit) {
      const wasSelected = ui.selection.includes(hit)
      const additive = event.shiftKey || event.metaKey || event.ctrlKey
      const selected = additive
        ? wasSelected
          ? ui.selection
          : [...ui.selection, hit]
        : wasSelected
          ? ui.selection
          : [hit]
      ui.select(selected)
      if (ui.activeId && ui.activeId !== hit) actions.exitEdit()
      event.currentTarget.setPointerCapture(event.pointerId)
      setGesture({
        kind: 'move',
        pointerId: event.pointerId,
        start: world,
        ids: canEdit ? selected : [],
        moved: false,
        hit,
        additive,
        wasSelected,
      })
      return
    }
    if (ui.activeId) actions.exitEdit()
    event.currentTarget.setPointerCapture(event.pointerId)
    const additive = event.shiftKey
    if (!additive) ui.select([])
    setGesture({
      kind: 'marquee',
      pointerId: event.pointerId,
      start: world,
      additive,
      base: additive ? ui.selection : [],
    })
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, local(event))
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [Point, Point]
      const distance = Math.hypot(a.x - b.x, a.y - b.y)
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const current = useCanvasViewport.getState().viewport
      const zoomed = zoomAt(
        current,
        mid,
        current.zoom * (distance / Math.max(1, pinch.current.distance))
      )
      moveCamera(panBy(zoomed, mid.x - pinch.current.mid.x, mid.y - pinch.current.mid.y))
      pinch.current = { distance, mid }
      return
    }
    if (!gesture || gesture.pointerId !== event.pointerId) return
    const point = local(event)
    if (gesture.kind === 'pan') {
      moveCamera({
        ...viewport,
        panX: gesture.panX + point.x - gesture.start.x,
        panY: gesture.panY + point.y - gesture.start.y,
      })
      return
    }
    const world = screenToWorld(viewport, point)
    if (gesture.kind === 'marquee') {
      const rect = rectFromPoints(gesture.start, world)
      setMarquee(rect)
      useCanvasUi.getState().select([...gesture.base, ...marqueeSelect(items, rect)])
      return
    }
    if (gesture.kind === 'move') {
      let dx = world.x - gesture.start.x
      let dy = world.y - gesture.start.y
      if (!gesture.moved && Math.hypot(dx, dy) * viewport.zoom < DRAG_THRESHOLD) return
      if (!gesture.ids.length) return
      if (!gesture.moved) setGesture({ ...gesture, moved: true })
      const moved = boundsOf(
        items.filter((item) => gesture.ids.includes(item.id)).map((item) => item.rect)
      )!
      const visible = visibleWorldRect(viewport, screen, 200)
      const others = items
        .filter((item) => !gesture.ids.includes(item.id) && intersects(item.rect, visible))
        .map((item) => item.rect)
      const snap = event.altKey
        ? { dx: 0, dy: 0, guides: [] }
        : snapMove({ ...moved, x: moved.x + dx, y: moved.y + dy }, others, threshold, gridSize)
      dx += snap.dx
      dy += snap.dy
      setGuides(snap.guides)
      setDrag({ dx, dy })
      return
    }
    if (gesture.kind === 'resize') {
      setResizing({
        id: gesture.id,
        rect: resizedRect(gesture, world, event.shiftKey || gesture.keepRatio, gridSize),
      })
    }
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    if (!gesture || gesture.pointerId !== event.pointerId) return
    if (gesture.kind === 'move') {
      if (gesture.moved && drag && (drag.dx || drag.dy)) {
        actions.move(
          items
            .filter((item) => gesture.ids.includes(item.id))
            .map((item) => ({ id: item.id, x: item.rect.x + drag.dx, y: item.rect.y + drag.dy }))
        )
      } else if (!gesture.moved && gesture.additive && gesture.wasSelected) {
        useCanvasUi.getState().toggle(gesture.hit)
      } else if (!gesture.moved && !gesture.additive) {
        useCanvasUi.getState().select([gesture.hit])
      }
    }
    if (gesture.kind === 'resize' && resizing) {
      const { rect } = resizing
      const original = gesture.rect
      if (rect.width !== original.width || rect.height !== original.height)
        actions.resize(gesture.id, rect.width, rect.height)
      if (rect.x !== original.x || rect.y !== original.y)
        actions.move([{ id: gesture.id, x: rect.x, y: rect.y }])
    }
    setGesture(null)
    setDrag(null)
    setMarquee(null)
    setGuides([])
    setResizing(null)
  }

  function onDoubleClick(event: React.MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement
    if (target.closest('[data-canvas-editor],[data-board-control]')) return
    const labelId = target.closest<HTMLElement>('[data-artboard-label]')?.dataset.artboardLabel
    if (labelId && canEdit) {
      useCanvasUi.getState().rename(labelId)
      return
    }
    const hit = hitTest(items, screenToWorld(viewport, local(event)))
    if (hit && canEdit) actions.edit(hit)
  }

  function onContextMenu(event: React.MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement
    if (target.closest('[data-canvas-editor]')) {
      event.preventDefault()
      return
    }
    const world = screenToWorld(viewport, local(event))
    const labelId = target.closest<HTMLElement>('[data-artboard-label]')?.dataset.artboardLabel
    const hit = labelId ?? hitTest(items, world)
    if (hit && !useCanvasUi.getState().selection.includes(hit)) useCanvasUi.getState().select([hit])
    setMenuTarget({ id: hit, at: world })
  }

  const visible = visibleWorldRect(viewport, screen, 300)
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio
  const offsetFor = (id: string) =>
    drag && gesture?.kind === 'move' && gesture.ids.includes(id) ? drag : null
  const gridStep = (() => {
    let step = grid.size * viewport.zoom
    while (step < 8) step *= 4
    return step
  })()
  const cursor =
    gesture?.kind === 'pan' ? 'grabbing' : tool === 'hand' || spaceHeld ? 'grab' : 'default'
  const menuArtboard = artboards.find((artboard) => artboard.id === menuTarget.id)

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild disabled={!canEdit}>
        <div
          ref={container}
          role="application"
          aria-label="Canvas board"
          aria-roledescription="infinite canvas"
          tabIndex={0}
          data-testid="canvas-board"
          className="relative h-full w-full touch-none overflow-hidden bg-[#eceeed] outline-none dark:bg-[#141615]"
          style={{
            cursor,
            backgroundImage: grid.visible
              ? 'radial-gradient(circle, rgba(120,130,125,0.35) 1px, transparent 1px)'
              : undefined,
            backgroundSize: grid.visible ? `${gridStep}px ${gridStep}px` : undefined,
            backgroundPosition: grid.visible ? `${viewport.panX}px ${viewport.panY}px` : undefined,
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={onDoubleClick}
          onContextMenu={onContextMenu}
          onDragOver={(event) => {
            if (canEdit && event.dataTransfer.types.includes('Files')) event.preventDefault()
          }}
          onDrop={(event) => {
            if (!canEdit) return
            const files = Array.from(event.dataTransfer.files).filter((file) =>
              file.type.startsWith('image/')
            )
            if (!files.length) return
            event.preventDefault()
            onDropFiles(files, screenToWorld(viewport, local(event)))
          }}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute left-0 top-0 origin-top-left"
            style={{
              transform: `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`,
            }}
          >
            {items.map(({ id, rect, artboard }) => {
              const onScreen = intersects(rect, visible)
              const offset = offsetFor(id)
              return (
                <div
                  key={id}
                  data-artboard-id={id}
                  className="absolute shadow-[0_1px_3px_rgba(0,0,0,0.12),0_8px_24px_rgba(0,0,0,0.08)]"
                  style={{
                    left: rect.x + (offset?.dx ?? 0),
                    top: rect.y + (offset?.dy ?? 0),
                    width: rect.width,
                    height: rect.height,
                  }}
                >
                  {onScreen ? (
                    <ArtboardPreview
                      document={artboard.document}
                      name={artboard.name}
                      enabled={id !== activeId}
                      width={previewWidthFor(rect.width * settledZoom, dpr)}
                    />
                  ) : null}
                </div>
              )
            })}
          </div>
          <BoardOverlay
            items={items}
            viewport={viewport}
            selection={selection}
            activeId={activeId}
            renamingId={renamingId}
            offsetFor={offsetFor}
            resizing={resizing}
            canEdit={canEdit}
            actions={actions}
            showHandles={canEdit && selection.length === 1 && selection[0] !== activeId && !gesture}
          />
          {editor}
          {marquee ? (
            <div
              aria-hidden
              className="pointer-events-none absolute border border-sky-500 bg-sky-500/10"
              style={rectStyle(rectToScreen(viewport, marquee))}
            />
          ) : null}
          {guides.map((guide, index) => {
            const start = rectToScreen(
              viewport,
              guide.axis === 'x'
                ? { x: guide.position, y: guide.from, width: 0, height: guide.to - guide.from }
                : { x: guide.from, y: guide.position, width: guide.to - guide.from, height: 0 }
            )
            return (
              <div
                key={index}
                aria-hidden
                className="pointer-events-none absolute bg-pink-500"
                style={
                  guide.axis === 'x'
                    ? { left: start.x, top: start.y, width: 1, height: start.height }
                    : { left: start.x, top: start.y, width: start.width, height: 1 }
                }
              />
            )
          })}
          {!artboards.length ? (
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <p className="rounded-lg bg-background/80 px-4 py-2 text-sm text-muted-foreground">
                Add an artboard from the Insert panel, or drop a screenshot here.
              </p>
            </div>
          ) : null}
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          className="z-50 min-w-48 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          aria-label={menuArtboard ? `${menuArtboard.name} actions` : 'Canvas actions'}
        >
          {menuArtboard ? (
            <>
              <ContextMenu.Item className={menuItem} onSelect={() => actions.edit(menuArtboard.id)}>
                Edit artboard
              </ContextMenu.Item>
              <ContextMenu.Item
                className={menuItem}
                onSelect={() => useCanvasUi.getState().rename(menuArtboard.id)}
              >
                Rename
              </ContextMenu.Item>
              <ContextMenu.Item className={menuItem} onSelect={() => actions.duplicate()}>
                Duplicate
              </ContextMenu.Item>
              <ContextMenu.Sub>
                <ContextMenu.SubTrigger className={menuItem}>
                  Create format ›
                </ContextMenu.SubTrigger>
                <ContextMenu.Portal>
                  <ContextMenu.SubContent className="z-50 min-w-48 rounded-md border bg-popover p-1 shadow-md">
                    {artboardPresetSchema.options.map((preset) => (
                      <ContextMenu.Item
                        key={preset}
                        className={menuItem}
                        onSelect={() => actions.adaptTo(useCanvasUi.getState().selection, [preset])}
                      >
                        {ARTBOARD_PRESETS[preset].name}
                      </ContextMenu.Item>
                    ))}
                  </ContextMenu.SubContent>
                </ContextMenu.Portal>
              </ContextMenu.Sub>
              <ContextMenu.Item className={menuItem} onSelect={() => actions.copy()}>
                Copy
              </ContextMenu.Item>
              <ContextMenu.Separator className="my-1 h-px bg-border" />
              <ContextMenu.Item className={menuItem} onSelect={() => actions.stack('front')}>
                Bring to front
              </ContextMenu.Item>
              <ContextMenu.Item className={menuItem} onSelect={() => actions.stack('back')}>
                Send to back
              </ContextMenu.Item>
              <ContextMenu.Item className={menuItem} onSelect={() => actions.fitSelection()}>
                Zoom to selection
              </ContextMenu.Item>
              <ContextMenu.Separator className="my-1 h-px bg-border" />
              <ContextMenu.Item
                className={cn(menuItem, 'text-destructive')}
                onSelect={() => actions.remove()}
              >
                Delete
              </ContextMenu.Item>
            </>
          ) : (
            <>
              <ContextMenu.Sub>
                <ContextMenu.SubTrigger className={menuItem}>
                  Add artboard here ›
                </ContextMenu.SubTrigger>
                <ContextMenu.Portal>
                  <ContextMenu.SubContent className="z-50 min-w-48 rounded-md border bg-popover p-1 shadow-md">
                    {artboardPresetSchema.options.map((preset) => (
                      <ContextMenu.Item
                        key={preset}
                        className={menuItem}
                        onSelect={() => {
                          const size = ARTBOARD_PRESETS[preset]
                          const id = actions.addPreset(preset)
                          actions.move([
                            {
                              id,
                              x: snapToGrid(menuTarget.at.x - size.width / 2, gridSize),
                              y: snapToGrid(menuTarget.at.y - size.height / 2, gridSize),
                            },
                          ])
                        }}
                      >
                        {ARTBOARD_PRESETS[preset].name}
                      </ContextMenu.Item>
                    ))}
                  </ContextMenu.SubContent>
                </ContextMenu.Portal>
              </ContextMenu.Sub>
              <ContextMenu.Item className={menuItem} onSelect={() => actions.paste()}>
                Paste
              </ContextMenu.Item>
              <ContextMenu.Item className={menuItem} onSelect={() => actions.selectAll()}>
                Select all
              </ContextMenu.Item>
              <ContextMenu.Item className={menuItem} onSelect={() => actions.tidy()}>
                Tidy up
              </ContextMenu.Item>
              <ContextMenu.Item className={menuItem} onSelect={() => actions.fitAll()}>
                Zoom to fit
              </ContextMenu.Item>
            </>
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}

function rectStyle(rect: WorkspaceRect): React.CSSProperties {
  return { left: rect.x, top: rect.y, width: rect.width, height: rect.height }
}

/** The rectangle a resize handle drag produces, in whole pixels, never below 64. */
function resizedRect(
  gesture: Extract<Gesture, { kind: 'resize' }>,
  world: Point,
  keepRatio: boolean,
  grid: number | null
): WorkspaceRect {
  const { rect, handle, start } = gesture
  const dx = world.x - start.x
  const dy = world.y - start.y
  let left = rect.x
  let top = rect.y
  let right = rect.x + rect.width
  let bottom = rect.y + rect.height
  if (handle.includes('w')) left = snapToGrid(left + dx, grid)
  if (handle.includes('e')) right = snapToGrid(right + dx, grid)
  if (handle.includes('n')) top = snapToGrid(top + dy, grid)
  if (handle.includes('s')) bottom = snapToGrid(bottom + dy, grid)
  let width = Math.min(8192, Math.max(64, right - left))
  let height = Math.min(8192, Math.max(64, bottom - top))
  if (keepRatio) {
    const ratio = rect.width / rect.height
    if (handle === 'n' || handle === 's') width = height * ratio
    else height = width / ratio
  }
  width = Math.round(width)
  height = Math.round(height)
  if (handle.includes('w')) left = rect.x + rect.width - width
  if (handle.includes('n')) top = rect.y + rect.height - height
  return { x: Math.round(left), y: Math.round(top), width, height }
}

/** Screen-space chrome: names, selection, handles. Text stays crisp at any zoom. */
function BoardOverlay({
  items,
  viewport,
  selection,
  activeId,
  renamingId,
  offsetFor,
  resizing,
  showHandles,
  canEdit,
  actions,
}: {
  items: { id: string; rect: WorkspaceRect; artboard: Artboard }[]
  viewport: { panX: number; panY: number; zoom: number }
  selection: string[]
  activeId: string | null
  renamingId: string | null
  offsetFor: (id: string) => { dx: number; dy: number } | null
  resizing: { id: string; rect: WorkspaceRect } | null
  showHandles: boolean
  canEdit: boolean
  actions: CanvasActions
}) {
  return (
    <>
      {items.map(({ id, rect: base, artboard }) => {
        const offset = offsetFor(id)
        const rect =
          resizing?.id === id
            ? resizing.rect
            : offset
              ? { ...base, x: base.x + offset.dx, y: base.y + offset.dy }
              : base
        const box = rectToScreen(viewport, rect)
        if (
          box.x > 10_000 ||
          box.y > 10_000 ||
          box.x + box.width < -10_000 ||
          box.y + box.height < -10_000
        )
          return null
        const selected = selection.includes(id)
        const active = id === activeId
        return (
          <div key={id}>
            {box.width >= 40 ? (
              renamingId === id ? (
                <input
                  data-board-control
                  aria-label="Artboard name"
                  autoFocus
                  defaultValue={artboard.name}
                  maxLength={120}
                  className="absolute z-30 h-6 rounded border bg-background px-1 text-xs"
                  style={{
                    left: box.x,
                    top: box.y - 26,
                    width: Math.max(140, Math.min(box.width, 320)),
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur()
                    if (event.key === 'Escape') useCanvasUi.getState().rename(null)
                  }}
                  onBlur={(event) => {
                    if (useCanvasUi.getState().renamingId === id) {
                      actions.rename(id, event.currentTarget.value)
                      useCanvasUi.getState().rename(null)
                    }
                  }}
                />
              ) : (
                <div
                  data-artboard-label={id}
                  className={cn(
                    'absolute z-20 flex h-5 cursor-default select-none items-center gap-1 truncate text-xs',
                    selected || active ? 'text-sky-600 dark:text-sky-400' : 'text-muted-foreground'
                  )}
                  style={{ left: box.x, top: box.y - 22, maxWidth: box.width }}
                  title={`${artboard.name} · ${Math.round(rect.width)} × ${Math.round(rect.height)}`}
                >
                  <span className="truncate">{artboard.name}</span>
                  {active ? (
                    <span className="shrink-0 rounded bg-sky-500 px-1 text-[10px] text-white">
                      Editing
                    </span>
                  ) : null}
                  {selected && box.width > 160 ? (
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {Math.round(rect.width)} × {Math.round(rect.height)}
                    </span>
                  ) : null}
                </div>
              )
            ) : null}
            {selected || active ? (
              <div
                aria-hidden
                className={cn(
                  'pointer-events-none absolute z-10 border-2',
                  active ? 'border-sky-500' : 'border-sky-500/90'
                )}
                style={rectStyle({
                  x: box.x - 1,
                  y: box.y - 1,
                  width: box.width + 2,
                  height: box.height + 2,
                })}
              />
            ) : null}
            {showHandles && selected && canEdit
              ? HANDLES.map((handle) => {
                  const x = handle.includes('w')
                    ? box.x
                    : handle.includes('e')
                      ? box.x + box.width
                      : box.x + box.width / 2
                  const y = handle.includes('n')
                    ? box.y
                    : handle.includes('s')
                      ? box.y + box.height
                      : box.y + box.height / 2
                  return (
                    <div
                      key={handle}
                      data-resize-handle={handle}
                      role="presentation"
                      className="absolute z-20 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-[2px] border border-sky-600 bg-white"
                      style={{ left: x, top: y, cursor: `${handle}-resize` }}
                    />
                  )
                })
              : null}
          </div>
        )
      })}
    </>
  )
}
