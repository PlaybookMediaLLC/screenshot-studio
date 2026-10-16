'use client'

import { motion } from 'motion/react'
import { z } from 'zod'
import { cn } from '@/lib/utils'
import { MONO, MUTED } from '../primitives'
import {
  diagramToneSchema,
  EASE,
  TONE,
  toneColor,
  TRANSITION,
  type DiagramTone,
} from './flow-parts'

/** Lit stroke color per tone: white, emerald-400, amber-400, red-400. */
export const TONE_STROKE: Record<DiagramTone, string> = {
  neutral: toneColor(TONE.neutral, 0.6),
  success: toneColor(TONE.success),
  attention: toneColor(TONE.attention),
  failure: toneColor(TONE.failure),
}

const DIM = 'rgba(255,255,255,0.16)'
const DIM_MARKER = 'dim'
const HALO = '#111111'

/** Horizontal alignment of an SVG label relative to its x. */
export const labelAnchorSchema = z.enum(['start', 'middle', 'end'])

/** Horizontal alignment of an SVG label relative to its x. */
export type LabelAnchor = z.infer<typeof labelAnchorSchema>

/** Label anchor values. */
export const ANCHOR = labelAnchorSchema.enum

/** A rectangle on a diagram board, in viewBox units. */
export type Box = { x: number; y: number; w: number; h: number }

/** The id of the arrowhead marker for a tone, or the dim one when `tone` is omitted. */
export const markerUrl = (id: string, tone?: DiagramTone) => `url(#${id}-${tone ?? DIM_MARKER})`

/** Arrowhead markers for every tone plus the dim base. Render inside `<defs>`. */
export function ArrowMarkers({ id }: { id: string }) {
  const fills: [string, string][] = [
    [DIM_MARKER, 'rgba(255,255,255,0.3)'],
    ...diagramToneSchema.options.map((tone): [string, string] => [tone, TONE_STROKE[tone]]),
  ]
  return (
    <>
      {fills.map(([key, fill]) => (
        <marker
          id={`${id}-${key}`}
          key={key}
          markerHeight={7}
          markerUnits="userSpaceOnUse"
          markerWidth={7}
          orient="auto-start-reverse"
          refX={7}
          refY={4}
          viewBox="0 0 8 8"
        >
          <path d="M0 0 L8 4 L0 8 z" fill={fill} />
        </marker>
      ))}
    </>
  )
}

/** A state on an SVG board: a rounded box with its UPPER_SNAKE name. */
export function SvgNode({
  active = false,
  box,
  label,
  lit,
  tone,
}: {
  active?: boolean
  box: Box
  label: string
  lit: boolean
  tone: DiagramTone
}) {
  const stroke = active && tone === TONE.neutral ? '#ffffff' : lit ? TONE_STROKE[tone] : DIM
  return (
    <motion.g animate={{ opacity: lit ? 1 : 0.45 }} initial={false} transition={TRANSITION}>
      <motion.rect
        animate={{ stroke }}
        fill="#161616"
        height={box.h}
        initial={false}
        rx={8}
        strokeWidth={1}
        transition={TRANSITION}
        width={box.w}
        x={box.x}
        y={box.y}
      />
      <text
        dominantBaseline="central"
        fill="#ffffff"
        fontSize={11.5}
        textAnchor="middle"
        x={box.x + box.w / 2}
        y={box.y + box.h / 2}
      >
        {label}
      </text>
    </motion.g>
  )
}

/** An edge: a dim base path that is always drawn, with a lit overlay that draws in. */
export function SvgEdge({
  d,
  lit,
  markers,
  tone,
}: {
  d: string
  lit: boolean
  markers: string
  tone: DiagramTone
}) {
  return (
    <g fill="none">
      <path d={d} markerEnd={markerUrl(markers)} stroke={DIM} strokeWidth={1.25} />
      <motion.path
        animate={{ opacity: lit ? 1 : 0, pathLength: lit ? 1 : 0 }}
        d={d}
        initial={false}
        markerEnd={markerUrl(markers, tone)}
        stroke={TONE_STROKE[tone]}
        strokeWidth={1.5}
        transition={{ duration: 0.4, ease: EASE }}
      />
    </g>
  )
}

/** An edge label with a background halo, plus an optional muted second line. */
export function SvgLabel({
  anchor = ANCHOR.middle,
  lit,
  sub,
  text,
  x,
  y,
}: {
  anchor?: LabelAnchor
  lit: boolean
  sub?: string
  text: string
  x: number
  y: number
}) {
  return (
    <motion.text
      animate={{ opacity: lit ? 1 : 0.5 }}
      fontSize={10.5}
      initial={false}
      paintOrder="stroke"
      stroke={HALO}
      strokeLinejoin="round"
      strokeWidth={4}
      textAnchor={anchor}
      transition={TRANSITION}
      x={x}
      y={y}
    >
      <tspan fill="rgba(255,255,255,0.8)">{text}</tspan>
      {sub ? (
        <tspan dy={13} fill="#858585" fontSize={10} x={x}>
          {sub}
        </tspan>
      ) : null}
    </motion.text>
  )
}

const CHIP_TONE: Record<DiagramTone, string> = {
  neutral: 'border-white/20',
  success: 'border-emerald-400/60',
  attention: 'border-amber-400/60',
  failure: 'border-red-400/60',
}

/** An HTML state chip for stacked mobile layouts and lane diagrams. */
export function StateChip({ state, tone }: { state: string; tone: DiagramTone }) {
  return (
    <span
      className={cn(
        MONO,
        'inline-flex h-8 shrink-0 items-center rounded-lg border bg-[#161616] px-2.5 text-[11.5px] text-white',
        CHIP_TONE[tone]
      )}
    >
      {state}
    </span>
  )
}

/** One row of a stacked state diagram: the edge taken (`via`), the state, and a note. */
export function StackRow({
  detail,
  lit,
  state,
  tone,
  via,
}: {
  detail?: string
  lit: boolean
  state: string
  tone: DiagramTone
  via?: string
}) {
  return (
    <motion.li
      animate={{ opacity: lit ? 1 : 0.4 }}
      className="flex flex-col gap-2"
      initial={false}
      transition={TRANSITION}
    >
      {via ? (
        <span className={cn(MONO, 'flex items-start gap-2 pl-3 text-[10.5px] text-white/55')}>
          <span aria-hidden="true">↓</span>
          {via}
        </span>
      ) : null}
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StateChip state={state} tone={tone} />
        {detail ? <span className={cn('text-[13px] leading-[1.4]', MUTED)}>{detail}</span> : null}
      </span>
    </motion.li>
  )
}
