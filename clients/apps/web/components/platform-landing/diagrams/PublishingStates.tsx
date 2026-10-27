'use client'

import { useId } from 'react'
import { motion } from 'motion/react'
import { z } from 'zod'
import { cn } from '@/lib/utils'
import { MONO } from '../primitives'
import { EASE, TONE, type DiagramTone } from './flow-parts'
import {
  ANCHOR,
  ArrowMarkers,
  StackRow,
  SvgEdge,
  SvgLabel,
  SvgNode,
  TONE_STROKE,
  type Box,
  type LabelAnchor,
} from './state-parts'
import { useDiagramStep } from './useDiagramStep'

/**
 * Scheduled post states, mirrored from server/ent/schema/scheduledpost.go.
 * Transitions follow server/internal/publishing/repository.go and
 * server/internal/temporalpublishing/workflow_v2.go.
 */
const stateSchema = z.enum([
  'DRAFT',
  'SCHEDULED',
  'PROCESSING',
  'PUBLISHED',
  'CANCELLED',
  'FAILED',
  'UNKNOWN_DELIVERY',
])
type State = z.infer<typeof stateSchema>
const S = stateSchema.enum

const W = 960
const H = 360
/** Top of the visible board: the retry arc and its label start just below. */
const TOP = 36
const NODE_W = 150
const NODE_H = 40
const ROW = 120
const EXIT_ROW = 260
const MID = ROW + NODE_H / 2

const BOXES: Record<State, Box> = {
  DRAFT: { x: 0, y: ROW, w: NODE_W, h: NODE_H },
  SCHEDULED: { x: 270, y: ROW, w: NODE_W, h: NODE_H },
  PROCESSING: { x: 540, y: ROW, w: NODE_W, h: NODE_H },
  PUBLISHED: { x: 810, y: ROW, w: NODE_W, h: NODE_H },
  CANCELLED: { x: 270, y: EXIT_ROW, w: NODE_W, h: NODE_H },
  FAILED: { x: 540, y: EXIT_ROW, w: NODE_W, h: NODE_H },
  UNKNOWN_DELIVERY: { x: 810, y: EXIT_ROW, w: NODE_W, h: NODE_H },
}

const center = (state: State) => BOXES[state].x + NODE_W / 2

/** The step on which each state lights. The happy path runs first, then the exits. */
const STATE_STEP: Record<State, number> = {
  DRAFT: 0,
  SCHEDULED: 1,
  PROCESSING: 2,
  PUBLISHED: 3,
  CANCELLED: 5,
  FAILED: 7,
  UNKNOWN_DELIVERY: 8,
}

const TONES: Record<State, DiagramTone> = {
  DRAFT: TONE.neutral,
  SCHEDULED: TONE.neutral,
  PROCESSING: TONE.neutral,
  PUBLISHED: TONE.success,
  CANCELLED: TONE.neutral,
  FAILED: TONE.failure,
  UNKNOWN_DELIVERY: TONE.attention,
}

const HAPPY: State[] = [S.DRAFT, S.SCHEDULED, S.PROCESSING, S.PUBLISHED]

type Edge = {
  from: State
  to: State
  step: number
  d: string
  label?: {
    text: string
    sub?: string
    x: number
    y: number
    anchor?: LabelAnchor
  }
}

/**
 * Retry is drawn back to SCHEDULED, not as a self-loop: on a 429 or 500 the
 * worker sets the post back to SCHEDULED with a new send time
 * (repository.go Fail with retryAt), then claims it again.
 */
const EDGES: Edge[] = [
  {
    from: S.DRAFT,
    to: S.SCHEDULED,
    step: 1,
    d: `M150 ${MID} L266 ${MID}`,
    label: { text: 'schedule', x: 210, y: MID - 10 },
  },
  {
    from: S.SCHEDULED,
    to: S.PROCESSING,
    step: 2,
    d: `M420 ${MID} L536 ${MID}`,
    label: { text: 'timer fires', sub: 'one worker', x: 480, y: MID - 24 },
  },
  {
    from: S.PROCESSING,
    to: S.PUBLISHED,
    step: 3,
    d: `M690 ${MID} L806 ${MID}`,
    label: { text: 'confirmation', x: 750, y: MID - 10 },
  },
  {
    from: S.PROCESSING,
    to: S.SCHEDULED,
    step: 4,
    d: `M600 ${ROW} C600 50 360 50 360 ${ROW - 4}`,
    label: { text: 'retry 429 · 500', x: 480, y: 56 },
  },
  {
    from: S.SCHEDULED,
    to: S.CANCELLED,
    step: 5,
    d: `M345 ${ROW + NODE_H} L345 ${EXIT_ROW - 4}`,
    label: { text: 'cancel', x: 337, y: 214, anchor: ANCHOR.end },
  },
  {
    from: S.PROCESSING,
    to: S.CANCELLED,
    step: 6,
    d: `M585 ${ROW + NODE_H} C585 215 400 205 400 ${EXIT_ROW - 4}`,
    label: { text: 'no longer eligible', x: 470, y: 198 },
  },
  {
    from: S.PROCESSING,
    to: S.FAILED,
    step: 7,
    d: `M615 ${ROW + NODE_H} L615 ${EXIT_ROW - 4}`,
    label: { text: 'definite failure', x: 623, y: 238, anchor: ANCHOR.start },
  },
  {
    from: S.PROCESSING,
    to: S.UNKNOWN_DELIVERY,
    step: 8,
    d: `M650 ${ROW + NODE_H} C650 215 885 205 885 ${EXIT_ROW - 4}`,
    label: { text: 'uncertain outcome', x: 722, y: 186, anchor: ANCHOR.start },
  },
]

const COUNT = 9

/** What each exit means, wording from the STATES table on pages/PublishingPage.tsx. */
const NOTES: Partial<Record<State, string[]>> = {
  CANCELLED: [
    'Cancelled by a publisher, or no',
    'longer eligible at send time.',
    'No request sent.',
  ],
  FAILED: ['A definite failure, such as', 'an expired credential.', 'Nothing was published.'],
  UNKNOWN_DELIVERY: ['Outcome uncertain.', 'Held for a person,', 'never sent again.'],
}

const SUMMARY =
  'Post lifecycle. DRAFT becomes SCHEDULED when it is scheduled, PROCESSING when the timer fires and one worker claims it, and PUBLISHED when the network confirms it. A rate limit or server error (429, 500) sends it back to SCHEDULED to retry. A post that is cancelled, or no longer eligible at send time, becomes CANCELLED and no request is sent. A definite failure becomes FAILED. An uncertain outcome becomes UNKNOWN_DELIVERY and is held for a person, never sent again.'

function Board({ step }: { step: number }) {
  const markers = useId()
  const happyIndex = Math.min(step, HAPPY.length - 1)
  const published = step >= STATE_STEP.PUBLISHED
  return (
    <svg
      aria-hidden="true"
      className={cn(MONO, 'hidden h-auto w-full lg:block')}
      viewBox={`0 ${TOP} ${W} ${H - TOP}`}
    >
      <defs>
        <ArrowMarkers id={markers} />
      </defs>
      {EDGES.map((edge) => (
        <SvgEdge
          d={edge.d}
          key={`${edge.from}-${edge.to}`}
          lit={step >= edge.step}
          markers={markers}
          tone={TONES[edge.to]}
        />
      ))}
      <motion.circle
        animate={{
          cx: center(HAPPY[happyIndex]),
          fill: published ? TONE_STROKE.success : '#ffffff',
        }}
        cy={MID}
        initial={false}
        r={4}
        transition={{ duration: 0.4, ease: EASE }}
      />
      {stateSchema.options.map((state) => (
        <SvgNode
          active={HAPPY[happyIndex] === state && step <= STATE_STEP.PUBLISHED}
          box={BOXES[state]}
          key={state}
          label={state}
          lit={step >= STATE_STEP[state]}
          tone={TONES[state]}
        />
      ))}
      {EDGES.map((edge) =>
        edge.label ? (
          <SvgLabel
            anchor={edge.label.anchor}
            key={`${edge.from}-${edge.to}-label`}
            lit={step >= edge.step}
            sub={edge.label.sub}
            text={edge.label.text}
            x={edge.label.x}
            y={edge.label.y}
          />
        ) : null
      )}
      {Object.entries(NOTES).map(([state, lines]) => (
        <motion.text
          animate={{ opacity: step >= STATE_STEP[state as State] ? 1 : 0.35 }}
          fill="#858585"
          fontSize={11}
          initial={false}
          key={state}
          textAnchor="middle"
          transition={{ duration: 0.35, ease: EASE }}
          y={EXIT_ROW + NODE_H + 20}
        >
          {lines.map((line, index) => (
            <tspan dy={index === 0 ? 0 : 14} key={line} x={center(state as State)}>
              {line}
            </tspan>
          ))}
        </motion.text>
      ))}
    </svg>
  )
}

const STACK: { state: State; via?: string; detail?: string; lit: number }[] = [
  { state: S.DRAFT, lit: 0 },
  { state: S.SCHEDULED, via: 'schedule', lit: 1 },
  {
    state: S.PROCESSING,
    via: 'timer fires · one worker',
    detail: 'A 429 or 500 goes back to SCHEDULED to retry.',
    lit: 2,
  },
  { state: S.PUBLISHED, via: 'confirmation', detail: 'Stored with the provider post ID.', lit: 3 },
  {
    state: S.CANCELLED,
    via: 'from SCHEDULED or PROCESSING',
    detail: NOTES.CANCELLED?.join(' '),
    lit: 5,
  },
  { state: S.FAILED, via: 'from PROCESSING', detail: NOTES.FAILED?.join(' '), lit: 7 },
  {
    state: S.UNKNOWN_DELIVERY,
    via: 'from PROCESSING',
    detail: NOTES.UNKNOWN_DELIVERY?.join(' '),
    lit: 8,
  },
]

/**
 * The scheduled post lifecycle: DRAFT to SCHEDULED to PROCESSING to PUBLISHED,
 * the retry back to SCHEDULED, and the three exits (CANCELLED, FAILED,
 * UNKNOWN_DELIVERY). A dot runs the happy path, then the exits light one by
 * one. Stacks into a list below the lg breakpoint.
 */
export function PublishingStates() {
  const { ref, step } = useDiagramStep<HTMLDivElement>(COUNT, 800)
  return (
    <div
      aria-label={SUMMARY}
      className="w-full rounded-xl border border-[#212121] bg-[#111] p-4 sm:p-6"
      ref={ref}
      role="img"
    >
      <Board step={step} />
      <ol className="flex flex-col gap-4 lg:hidden">
        {STACK.map((row) => (
          <StackRow
            detail={row.detail}
            key={row.state}
            lit={step >= row.lit}
            state={row.state}
            tone={TONES[row.state]}
            via={row.via}
          />
        ))}
      </ol>
    </div>
  )
}
