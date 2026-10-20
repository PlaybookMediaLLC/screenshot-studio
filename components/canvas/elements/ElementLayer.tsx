'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import Moveable from 'react-moveable'
import { canvasScale } from '@/lib/editor/snap-dom'
import { elementWithMotion } from '@/lib/animation/motion-evaluate'
import { useLayerMotions } from '@/lib/animation/use-motion'
import { shouldIgnoreEditorShortcut } from '@/lib/editor-shortcuts'
import type { CanvasElement, ElementOf } from '@/lib/editor/elements/schema'
import { useImageStore } from '@/lib/store'
import { useMoveableSnapping } from '../use-moveable-snapping'
import { fallbackImageRect, useCanvasGeometry } from './canvas-geometry'
import { calloutSourceRect, type ElementBox, ElementContent } from './element-renderers'

/** Elements that keep a square box when resized. */
const KEEP_RATIO = new Set<CanvasElement['type']>(['badge', 'cursor'])

function boxOf(element: CanvasElement, width: number, height: number): ElementBox {
  const w = element.width * width
  const h = element.height * height
  return { height: h, width: w, x: element.x * width - w / 2, y: element.y * height - h / 2 }
}

/** Lines from each callout to the region it magnifies, and that region's outline. */
function CalloutLinks({ elements }: { elements: readonly CanvasElement[] }) {
  const geometry = useCanvasGeometry()
  const callouts = elements.filter(
    (element): element is ElementOf<'callout'> => element.type === 'callout' && element.visible
  )
  if (callouts.length === 0 || !geometry.imageRect) return null
  return (
    <svg
      height={geometry.canvasH}
      style={{ left: 0, overflow: 'visible', pointerEvents: 'none', position: 'absolute', top: 0 }}
      width={geometry.canvasW}
    >
      {callouts.map((callout) => {
        const box = boxOf(callout, geometry.canvasW, geometry.canvasH)
        const source = calloutSourceRect(callout, box, geometry)
        if (!source) return null
        const { borderColor, borderWidth, connector, showSource } = callout.props
        const stroke = Math.max(1.5, borderWidth / 2)
        return (
          <g key={callout.id} opacity={callout.opacity}>
            {connector ? (
              <line
                stroke={borderColor}
                strokeDasharray={`${stroke * 3} ${stroke * 2}`}
                strokeWidth={stroke}
                x1={source.x + source.width / 2}
                x2={box.x + box.width / 2}
                y1={source.y + source.height / 2}
                y2={box.y + box.height / 2}
              />
            ) : null}
            {showSource ? (
              <rect
                fill="none"
                height={source.height}
                rx={callout.props.shape === 'circle' ? source.width / 2 : 4}
                stroke={borderColor}
                strokeWidth={stroke}
                width={source.width}
                x={source.x}
                y={source.y}
              />
            ) : null}
          </g>
        )
      })}
    </svg>
  )
}

/** Drag the region a selected callout magnifies, directly on the screenshot. */
function CalloutSourceHandle({ callout }: { callout: ElementOf<'callout'> }) {
  const geometry = useCanvasGeometry()
  const updateElement = useImageStore((state) => state.updateElement)
  const image = fallbackImageRect(geometry)
  const box = boxOf(callout, geometry.canvasW, geometry.canvasH)
  const source = calloutSourceRect(callout, box, geometry)
  const start = useRef<{ pointerX: number; pointerY: number; x: number; y: number } | null>(null)
  if (!image || !source) return null

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    start.current = { pointerX: event.clientX, pointerY: event.clientY, ...callout.props.source }
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!start.current) return
    const clamp = (value: number) => Math.min(1, Math.max(0, value))
    updateElement(callout.id, {
      props: {
        source: {
          x: clamp(start.current.x + (event.clientX - start.current.pointerX) / image.width / canvasScale(event.currentTarget)),
          y: clamp(start.current.y + (event.clientY - start.current.pointerY) / image.height / canvasScale(event.currentTarget)),
        },
      },
    })
  }
  return (
    <div
      aria-label="Drag to choose what the callout magnifies"
      data-export-exclude="true"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => (start.current = null)}
      role="slider"
      aria-valuetext={`${Math.round(callout.props.source.x * 100)}%, ${Math.round(callout.props.source.y * 100)}%`}
      style={{
        border: '2px dashed rgba(59,130,246,0.9)',
        cursor: 'move',
        height: source.height,
        left: source.x,
        pointerEvents: 'auto',
        position: 'absolute',
        top: source.y,
        touchAction: 'none',
        width: source.width,
      }}
    />
  )
}

/**
 * The canvas layer for composition elements: draws them in order and lets
 * the selected one move, resize, rotate, nudge with the arrow keys, and
 * delete, snapping like every other layer.
 */
export function ElementLayer({ zIndex }: { zIndex: number }) {
  const elements = useImageStore((state) => state.elements)
  const selectedId = useImageStore((state) => state.selectedElementId)
  const setSelectedElementId = useImageStore((state) => state.setSelectedElementId)
  const updateElement = useImageStore((state) => state.updateElement)
  const removeElement = useImageStore((state) => state.removeElement)
  const geometry = useCanvasGeometry()
  const [target, setTarget] = useState<HTMLDivElement | null>(null)
  const snapping = useMoveableSnapping(target, elements.length)
  const moveableRef = useRef<Moveable | null>(null)
  const selected = elements.find((element) => element.id === selectedId) ?? null
  const { canvasH, canvasW } = geometry
  // Elements are drawn as they are at the playhead; edits apply to the design.
  const motions = useLayerMotions('element')
  const shownElements = useMemo(
    () => elements.map((element) => (motions[element.id] ? elementWithMotion(element, motions[element.id]!) : element)),
    [elements, motions]
  )
  const shownSelected = shownElements.find((element) => element.id === selectedId) ?? null

  useEffect(() => {
    moveableRef.current?.updateRect()
  }, [shownSelected, canvasW, canvasH])

  const commitBox = useCallback(
    (node: HTMLElement | SVGElement, element: CanvasElement, shown: CanvasElement) => {
      const width = parseFloat(node.style.width)
      const height = parseFloat(node.style.height)
      const left = parseFloat(node.style.left)
      const top = parseFloat(node.style.top)
      // The box was moved as drawn; the change applies to the design under its motion.
      updateElement(element.id, {
        height: (element.height * height) / canvasH / shown.height,
        width: (element.width * width) / canvasW / shown.width,
        x: element.x + (left + width / 2) / canvasW - shown.x,
        y: element.y + (top + height / 2) / canvasH - shown.y,
      })
    },
    [canvasH, canvasW, updateElement]
  )

  useEffect(() => {
    if (!selected) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreEditorShortcut(event)) return
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        removeElement(selected.id)
        return
      }
      const step = event.shiftKey ? 10 : 1
      const moves: Record<string, [number, number]> = {
        ArrowDown: [0, step],
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
      }
      const move = moves[event.key]
      if (!move || selected.locked) return
      event.preventDefault()
      updateElement(selected.id, { x: selected.x + move[0] / canvasW, y: selected.y + move[1] / canvasH })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [canvasH, canvasW, removeElement, selected, updateElement])

  return (
    <div
      data-element-layer="true"
      style={{ inset: 0, overflow: 'visible', pointerEvents: 'none', position: 'absolute', zIndex }}
    >
      <CalloutLinks elements={shownElements} />
      {shownElements.map((element) => {
        if (!element.visible) return null
        const box = boxOf(element, canvasW, canvasH)
        return (
          <div
            data-element-id={element.id}
            data-element-type={element.type}
            key={element.id}
            onPointerDown={(event) => {
              event.stopPropagation()
              setSelectedElementId(element.id)
            }}
            ref={element.id === selectedId ? setTarget : undefined}
            style={{
              cursor: element.locked ? 'default' : 'move',
              height: box.height,
              left: box.x,
              opacity: element.opacity,
              outline: element.id === selectedId ? '1px solid rgba(59,130,246,0.6)' : undefined,
              pointerEvents: 'auto',
              position: 'absolute',
              top: box.y,
              transform: `rotate(${element.rotation}deg)`,
              width: box.width,
            }}
          >
            <ElementContent box={box} element={element} geometry={geometry} />
          </div>
        )
      })}
      {shownSelected?.type === 'callout' && shownSelected.visible ? (
        <CalloutSourceHandle callout={shownSelected} />
      ) : null}
      {selected && shownSelected && target && selected.visible && !selected.locked ? (
        <Moveable
          draggable
          edge={false}
          {...snapping}
          keepRatio={KEEP_RATIO.has(selected.type)}
          onDrag={({ left, target: node, top }) => {
            node.style.left = `${left}px`
            node.style.top = `${top}px`
          }}
          onDragEnd={({ target: node }) => commitBox(node, selected, shownSelected)}
          onResize={({ drag, height, target: node, width }) => {
            node.style.width = `${width}px`
            node.style.height = `${height}px`
            node.style.left = `${drag.left}px`
            node.style.top = `${drag.top}px`
          }}
          onResizeEnd={({ target: node }) => commitBox(node, selected, shownSelected)}
          onRotate={({ target: node, transform }) => {
            node.style.transform = transform
          }}
          onRotateEnd={({ target: node }) => {
            const match = node.style.transform.match(/rotate\(([-\d.]+)deg\)/)
            if (!match) return
            let degrees = (parseFloat(match[1]) - (shownSelected.rotation - selected.rotation)) % 360
            if (degrees > 180) degrees -= 360
            if (degrees < -180) degrees += 360
            updateElement(selected.id, { rotation: Math.round(degrees) })
          }}
          origin={false}
          ref={moveableRef}
          renderDirections={['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se']}
          resizable
          rotatable
          rotationPosition="top"
          target={target}
          throttleDrag={0}
          throttleResize={0}
          throttleRotate={0}
        />
      ) : null}
    </div>
  )
}
