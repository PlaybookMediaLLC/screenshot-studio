'use client'

import * as React from 'react'
import { EASING_BEZIERS, easeProgress, formatBezier } from '@/lib/animation/bezier'
import { type CubicBezier, easingSchema, type EasingName } from '@/lib/animation/motion-schema'
import { cn } from '@/lib/utils'

/** An easing as motion stores it: a named curve, or a custom curve that wins. */
export type EasingValue = { bezier?: CubicBezier; easing: EasingName }

/** A change to an easing; `bezier: null` goes back to the named curve. */
export type EasingChange = { bezier: CubicBezier | null; easing: EasingName }

/** Display names of the named easings. */
export const EASING_LABELS: Record<EasingName, string> = {
  'ease-in': 'Ease in',
  'ease-in-cubic': 'Ease in (cubic)',
  'ease-in-expo': 'Ease in (expo)',
  'ease-in-out': 'Ease in-out',
  'ease-out': 'Ease out',
  'ease-out-cubic': 'Ease out (cubic)',
  'ease-out-expo': 'Ease out (expo)',
  linear: 'Linear',
}

const SIZE = 168
const PAD = 14
/** The y range the graph shows; it grows to fit handles that overshoot. */
const BASE_RANGE = { max: 1.15, min: -0.15 }
const STEP = 0.01

type Handle = 1 | 2

const round = (value: number) => Math.round(value * 1000) / 1000
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/**
 * A cubic Bézier curve editor: the curve on a graph with two draggable
 * control points, arrow keys to nudge the focused point (Shift for larger
 * steps), and numeric fields for exact values. Picking a preset clears the
 * custom curve; moving a point starts one from the preset's shape.
 */
export function EasingField({
  label = 'Easing',
  onChange,
  value,
}: {
  label?: string
  onChange: (change: EasingChange) => void
  value: EasingValue
}) {
  const selectId = React.useId()
  const curve = value.bezier ?? EASING_BEZIERS[value.easing]
  const custom = Boolean(value.bezier)
  const svgRef = React.useRef<SVGSVGElement>(null)
  const [dragging, setDragging] = React.useState<Handle | null>(null)

  const range = {
    max: Math.max(BASE_RANGE.max, curve.y1 + 0.1, curve.y2 + 0.1),
    min: Math.min(BASE_RANGE.min, curve.y1 - 0.1, curve.y2 - 0.1),
  }
  const inner = SIZE - PAD * 2
  const toX = (x: number) => PAD + x * inner
  const toY = (y: number) => PAD + ((range.max - y) / (range.max - range.min)) * inner
  const fromPointer = (clientX: number, clientY: number) => {
    const box = svgRef.current?.getBoundingClientRect()
    if (!box) return null
    const scale = SIZE / box.width
    const x = ((clientX - box.left) * scale - PAD) / inner
    const y = range.max - (((clientY - box.top) * scale - PAD) / inner) * (range.max - range.min)
    return { x: round(clamp(x, 0, 1)), y: round(clamp(y, -2, 3)) }
  }

  const setPoint = (handle: Handle, point: { x: number; y: number }) => {
    const next: CubicBezier =
      handle === 1 ? { ...curve, x1: point.x, y1: point.y } : { ...curve, x2: point.x, y2: point.y }
    onChange({ bezier: next, easing: value.easing })
  }

  const samples = Array.from({ length: 49 }, (_, index) => {
    const progress = index / 48
    return `${toX(progress)},${toY(easeProgress(progress, value.easing, value.bezier))}`
  }).join(' ')

  const onKeyDown = (handle: Handle) => (event: React.KeyboardEvent<SVGCircleElement>) => {
    const step = event.shiftKey ? STEP * 10 : STEP
    const moves: Record<string, [number, number]> = {
      ArrowDown: [0, -step],
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, step],
    }
    const move = moves[event.key]
    if (!move) return
    event.preventDefault()
    const x = handle === 1 ? curve.x1 : curve.x2
    const y = handle === 1 ? curve.y1 : curve.y2
    setPoint(handle, { x: round(clamp(x + move[0], 0, 1)), y: round(clamp(y + move[1], -2, 3)) })
  }

  const handles: { handle: Handle; x: number; y: number; anchor: [number, number] }[] = [
    { anchor: [0, 0], handle: 1, x: curve.x1, y: curve.y1 },
    { anchor: [1, 1], handle: 2, x: curve.x2, y: curve.y2 },
  ]

  return (
    <div className="space-y-2" data-easing-field="">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs text-muted-foreground" htmlFor={selectId}>
          {label}
        </label>
        <select
          className="h-7 rounded-md border border-foreground/10 bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          id={selectId}
          onChange={(event) => {
            const next = event.target.value
            if (next === 'custom') onChange({ bezier: curve, easing: value.easing })
            else onChange({ bezier: null, easing: easingSchema.parse(next) })
          }}
          value={custom ? 'custom' : value.easing}
        >
          {easingSchema.options.map((name) => (
            <option key={name} value={name}>
              {EASING_LABELS[name]}
            </option>
          ))}
          <option value="custom">Custom curve</option>
        </select>
      </div>

      <svg
        aria-label={`${label} curve: ${custom ? formatBezier(curve) : EASING_LABELS[value.easing]}`}
        className="w-full max-w-[168px] touch-none select-none rounded-md border border-foreground/10 bg-foreground/[0.02]"
        data-bezier-editor=""
        onPointerMove={(event) => {
          if (!dragging) return
          const point = fromPointer(event.clientX, event.clientY)
          if (point) setPoint(dragging, point)
        }}
        onPointerUp={() => setDragging(null)}
        onPointerCancel={() => setDragging(null)}
        ref={svgRef}
        role="group"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
      >
        <rect
          className="fill-none stroke-foreground/10"
          height={toY(0) - toY(1)}
          width={inner}
          x={PAD}
          y={toY(1)}
        />
        <line
          className="stroke-foreground/10"
          strokeDasharray="3 3"
          x1={toX(0)}
          x2={toX(1)}
          y1={toY(0)}
          y2={toY(1)}
        />
        {handles.map(({ anchor, handle, x, y }) => (
          <line
            className={cn('stroke-foreground/40', !custom && 'opacity-50')}
            key={`arm-${handle}`}
            x1={toX(anchor[0])}
            x2={toX(x)}
            y1={toY(anchor[1])}
            y2={toY(y)}
          />
        ))}
        <polyline className="fill-none stroke-primary" points={samples} strokeWidth={2} />
        {handles.map(({ handle, x, y }) => (
          <circle
            aria-label={`Control point ${handle}: x ${x}, y ${y}. Arrow keys move it.`}
            className={cn(
              'cursor-grab fill-background stroke-primary outline-none focus-visible:stroke-[3px]',
              dragging === handle && 'cursor-grabbing',
              !custom && 'opacity-60'
            )}
            cx={toX(x)}
            cy={toY(y)}
            data-bezier-handle={handle}
            key={`handle-${handle}`}
            onKeyDown={onKeyDown(handle)}
            onPointerDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
              event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId)
              setDragging(handle)
            }}
            r={6}
            role="slider"
            aria-valuetext={`x ${x}, y ${y}`}
            strokeWidth={2}
            tabIndex={0}
          />
        ))}
      </svg>

      <div className="grid grid-cols-4 gap-1.5">
        {(['x1', 'y1', 'x2', 'y2'] as const).map((key) => (
          <label className="space-y-0.5" key={key}>
            <span className="block text-[10px] uppercase text-muted-foreground">{key}</span>
            <input
              aria-label={`Bézier ${key}`}
              className="h-7 w-full rounded-md border border-foreground/10 bg-background px-1.5 text-xs tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              max={key.startsWith('x') ? 1 : 3}
              min={key.startsWith('x') ? 0 : -2}
              onChange={(event) => {
                const number = Number(event.target.value)
                if (event.target.value === '' || !Number.isFinite(number)) return
                const limits = key.startsWith('x') ? [0, 1] : [-2, 3]
                onChange({
                  bezier: { ...curve, [key]: round(clamp(number, limits[0]!, limits[1]!)) },
                  easing: value.easing,
                })
              }}
              step={0.01}
              type="number"
              value={curve[key]}
            />
          </label>
        ))}
      </div>
    </div>
  )
}
