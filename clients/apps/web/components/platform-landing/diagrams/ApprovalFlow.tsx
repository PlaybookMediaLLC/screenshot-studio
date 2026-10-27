'use client'

import { useId } from 'react'
import { motion } from 'motion/react'
import { hasPermission, organizationRoles, type Permission } from '@/lib/auth/permissions'
import { campaignPostTransitions, type CampaignPostStatus } from '@/lib/tenant/campaign-status'
import { cn } from '@/lib/utils'
import { MONO } from '../primitives'
import { TONE, TRANSITION, type DiagramTone } from './flow-parts'
import {
  ANCHOR,
  ArrowMarkers,
  StackRow,
  SvgEdge,
  SvgLabel,
  SvgNode,
  type Box,
  type LabelAnchor,
} from './state-parts'
import { useDiagramStep } from './useDiagramStep'

const T = campaignPostTransitions

/**
 * Scheduling a campaign post needs `publish:manage`. Mirrored from
 * lib/trpc/routers/campaign.ts (schedulePost) and
 * server/internal/product/campaign_schedule.go; the transition map in
 * lib/tenant/campaign-status.ts covers only review decisions.
 */
const SCHEDULE_PERMISSION: Permission = 'publish:manage'

const rolesWith = (permission: Permission) =>
  organizationRoles.filter((role) => hasPermission(role, permission)).join(', ')

const TONES: Record<CampaignPostStatus, DiagramTone> = {
  DRAFT: TONE.neutral,
  READY_FOR_REVIEW: TONE.neutral,
  APPROVED: TONE.success,
  SCHEDULED: TONE.neutral,
  PUBLISHED: TONE.success,
  NEEDS_CHANGES: TONE.attention,
  REJECTED: TONE.failure,
}

/** Box widths fit each UPPER_SNAKE name at 11.5px mono. */
const WIDTHS: Record<CampaignPostStatus, number> = {
  DRAFT: 72,
  READY_FOR_REVIEW: 132,
  APPROVED: 86,
  SCHEDULED: 92,
  PUBLISHED: 92,
  NEEDS_CHANGES: 112,
  REJECTED: 86,
}

const HAPPY: CampaignPostStatus[] = [
  'DRAFT',
  'READY_FOR_REVIEW',
  'APPROVED',
  'SCHEDULED',
  'PUBLISHED',
]

const NODE_H = 36

type FlowEdge = {
  from: CampaignPostStatus
  to: CampaignPostStatus
  /** Plain-English action on the edge. */
  label: string
  /** Shorter label for the compact board, when the full one would collide. */
  short?: string
  /** Who may take it. Omitted for the delivery worker's confirmation. */
  permission?: Permission
}

/**
 * Edges in animation order: the happy path, then the review exits. Review
 * targets and permissions come from campaignPostTransitions; the NEEDS_CHANGES
 * resubmit is `submit`, whose `from` includes NEEDS_CHANGES.
 */
const EDGES: FlowEdge[] = [
  { from: 'DRAFT', to: T.submit.to, label: 'submit', permission: T.submit.permission },
  {
    from: T.approve.from[0],
    to: T.approve.to,
    label: 'approve',
    permission: T.approve.permission,
  },
  { from: 'APPROVED', to: 'SCHEDULED', label: 'schedule', permission: SCHEDULE_PERMISSION },
  { from: 'SCHEDULED', to: 'PUBLISHED', label: 'confirmation' },
  {
    from: T.request_changes.from[0],
    to: T.request_changes.to,
    label: 'request changes',
    permission: T.request_changes.permission,
  },
  {
    from: 'NEEDS_CHANGES',
    to: T.submit.to,
    label: 'edit, then resubmit',
    short: 'resubmit',
    permission: T.submit.permission,
  },
  { from: T.reject.from[0], to: T.reject.to, label: 'reject', permission: T.reject.permission },
]

const COUNT = EDGES.length + 1

/** A state lights on the step of the first edge into it; DRAFT is lit from the start. */
const stepOf = (state: CampaignPostStatus) =>
  state === 'DRAFT' ? 0 : EDGES.findIndex((edge) => edge.to === state) + 1

type Geometry = {
  w: number
  h: number
  boxes: Record<CampaignPostStatus, Box>
  paths: string[]
  labels: { x: number; y: number; anchor: LabelAnchor }[]
  notes: { state: CampaignPostStatus; text: string }[]
}

/** Lays the board out. Compact tightens the gaps because it drops the role lines. */
function layout(compact: boolean): Geometry {
  const gap = compact ? 96 : 164
  const top = compact ? 24 : 44
  const mid = top + NODE_H / 2
  const bottom = top + NODE_H
  const row2 = top + 160

  const boxes = {} as Record<CampaignPostStatus, Box>
  let x = 0
  for (const state of HAPPY) {
    boxes[state] = { x, y: top, w: WIDTHS[state], h: NODE_H }
    x += WIDTHS[state] + gap
  }
  const w = x - gap
  const r = boxes.READY_FOR_REVIEW.x
  const rejectX = r + WIDTHS.READY_FOR_REVIEW + gap / 2
  boxes.NEEDS_CHANGES = { x: r - 30, y: row2, w: WIDTHS.NEEDS_CHANGES, h: NODE_H }
  boxes.REJECTED = { x: rejectX - WIDTHS.REJECTED / 2, y: row2, w: WIDTHS.REJECTED, h: NODE_H }

  const right = (state: CampaignPostStatus) => boxes[state].x + boxes[state].w
  const happy = (index: number) => {
    const from = right(HAPPY[index])
    const to = boxes[HAPPY[index + 1]].x
    return {
      path: `M${from} ${mid} L${to - 4} ${mid}`,
      label: { x: (from + to) / 2, y: compact ? mid - 8 : mid - 19, anchor: ANCHOR.middle },
    }
  }
  const labelY = (bottom + row2) / 2 - 4
  const happyEdges = [0, 1, 2, 3].map(happy)

  return {
    w,
    h: row2 + NODE_H + 30,
    boxes,
    paths: [
      ...happyEdges.map((edge) => edge.path),
      `M${r + 20} ${bottom} L${r + 20} ${row2 - 4}`,
      `M${r + 48} ${row2} L${r + 48} ${bottom + 4}`,
      `M${right('READY_FOR_REVIEW')} ${top + 30} C${rejectX} ${top + 30} ${rejectX} ${top + 50} ${rejectX} ${row2 - 4}`,
    ],
    labels: [
      ...happyEdges.map((edge) => edge.label),
      { x: r + 12, y: labelY, anchor: ANCHOR.end },
      { x: r + 56, y: labelY - 10, anchor: ANCHOR.start },
      { x: rejectX + 8, y: labelY + 8, anchor: ANCHOR.start },
    ],
    notes: [
      { state: 'NEEDS_CHANGES', text: 'with the reviewer’s note' },
      { state: 'REJECTED', text: 'final' },
    ],
  }
}

const FULL = layout(false)
const COMPACT = layout(true)

const SUMMARY = `Approval flow. A teammate submits a DRAFT, making it READY_FOR_REVIEW (${rolesWith(T.submit.permission)}). A teammate with approval rights approves it to APPROVED, requests changes to NEEDS_CHANGES, or rejects it to REJECTED, which is final (${rolesWith(T.approve.permission)}). A post in NEEDS_CHANGES is edited, then resubmitted to READY_FOR_REVIEW. An APPROVED post is scheduled (${rolesWith(SCHEDULE_PERMISSION)}) to SCHEDULED, and becomes PUBLISHED on confirmation from the network.`

function Board({ compact, step }: { compact: boolean; step: number }) {
  const markers = useId()
  const geo = compact ? COMPACT : FULL
  return (
    <svg
      aria-hidden="true"
      className={cn(MONO, 'hidden h-auto w-full', compact ? 'md:block' : 'lg:block')}
      viewBox={`0 0 ${geo.w} ${geo.h}`}
    >
      <defs>
        <ArrowMarkers id={markers} />
      </defs>
      {EDGES.map((edge, index) => (
        <SvgEdge
          d={geo.paths[index]}
          key={`${edge.from}-${edge.to}`}
          lit={step > index}
          markers={markers}
          tone={TONES[edge.to]}
        />
      ))}
      {(Object.keys(geo.boxes) as CampaignPostStatus[]).map((state) => (
        <SvgNode
          active={step > 0 && EDGES[step - 1]?.to === state}
          box={geo.boxes[state]}
          key={state}
          label={state}
          lit={step >= stepOf(state)}
          tone={TONES[state]}
        />
      ))}
      {EDGES.map((edge, index) => (
        <SvgLabel
          anchor={geo.labels[index].anchor}
          key={`${edge.from}-${edge.to}-label`}
          lit={step > index}
          sub={
            compact ? undefined : edge.permission ? rolesWith(edge.permission) : 'delivery worker'
          }
          text={compact ? (edge.short ?? edge.label) : edge.label}
          x={geo.labels[index].x}
          y={geo.labels[index].y}
        />
      ))}
      {geo.notes.map(({ state, text }) => {
        const box = geo.boxes[state]
        return (
          <motion.text
            animate={{ opacity: step >= stepOf(state) ? 1 : 0.35 }}
            fill="#858585"
            fontSize={11}
            initial={false}
            key={state}
            textAnchor="middle"
            transition={TRANSITION}
            x={box.x + box.w / 2}
            y={box.y + NODE_H + 18}
          >
            {text}
          </motion.text>
        )
      })}
    </svg>
  )
}

/**
 * The campaign post approval state machine, driven by campaignPostTransitions
 * and the role permission table: DRAFT to READY_FOR_REVIEW to APPROVED to
 * SCHEDULED to PUBLISHED, with the NEEDS_CHANGES loop and REJECTED exit.
 * Each action edge names the roles allowed to take it. `compact` drops the
 * role lines and tightens the board for the homepage. Stacks into a list
 * below md (compact) or lg (full).
 */
export function ApprovalFlow({ compact = false }: { compact?: boolean }) {
  const { ref, step } = useDiagramStep<HTMLDivElement>(COUNT, 850)
  return (
    <div
      aria-label={SUMMARY}
      className="w-full rounded-xl border border-[#212121] bg-[#111] p-4 sm:p-6"
      ref={ref}
      role="img"
    >
      <Board compact={compact} step={step} />
      <ol className={cn('flex flex-col gap-4', compact ? 'md:hidden' : 'lg:hidden')}>
        <StackRow lit state="DRAFT" tone={TONES.DRAFT} />
        {EDGES.map((edge, index) => {
          const roles = edge.permission ? rolesWith(edge.permission) : 'delivery worker'
          const branch = index >= HAPPY.length - 1
          return (
            <StackRow
              detail={branch ? `from ${edge.from}` : undefined}
              key={`${edge.from}-${edge.to}`}
              lit={step > index}
              state={edge.to}
              tone={TONES[edge.to]}
              via={compact ? edge.label : `${edge.label} · ${roles}`}
            />
          )
        })}
      </ol>
    </div>
  )
}
