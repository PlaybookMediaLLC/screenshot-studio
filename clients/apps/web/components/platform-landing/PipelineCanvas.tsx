'use client'

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { z } from 'zod'
import { cn } from '@/lib/utils'
import { MONO, Tag } from './primitives'
import { useHydratedReducedMotion } from './useHydratedReducedMotion'

/** Nodes of the release-to-launch pipeline, in run order. */
export const pipelineNodeSchema = z.enum([
  'release',
  'spec',
  'plan',
  'visuals',
  'copy',
  'review',
  'publish',
])

/** One node of the release-to-launch pipeline. */
export type PipelineNode = z.infer<typeof pipelineNodeSchema>

const nodeStatusSchema = z.enum(['pending', 'active', 'done'])
type NodeStatus = z.infer<typeof nodeStatusSchema>

const NODE = pipelineNodeSchema.enum
const STATUS = nodeStatusSchema.enum

/** Canvas units. Everything is laid out on a 1200 x 560 board and scaled with the container. */
const W = 1200
const H = 560

/** Canvas units to container-query width, so the board scales as one picture. */
const u = (n: number) => `${(n / 12).toFixed(3)}cqw`

const BOXES: Record<PipelineNode, { x: number; y: number; w: number; h: number }> = {
  release: { x: 30, y: 190, w: 240, h: 170 },
  spec: { x: 330, y: 30, w: 230, h: 190 },
  plan: { x: 330, y: 300, w: 230, h: 190 },
  visuals: { x: 620, y: 20, w: 250, h: 250 },
  copy: { x: 620, y: 300, w: 250, h: 230 },
  review: { x: 930, y: 50, w: 240, h: 230 },
  publish: { x: 930, y: 350, w: 240, h: 180 },
}

const EDGES: { to: PipelineNode; d: string }[] = [
  { to: NODE.spec, d: 'M270 275 C300 275 300 125 330 125' },
  { to: NODE.plan, d: 'M445 220 L445 300' },
  { to: NODE.visuals, d: 'M560 395 C590 395 590 145 620 145' },
  { to: NODE.copy, d: 'M560 395 C590 395 590 415 620 415' },
  { to: NODE.review, d: 'M870 145 C900 145 900 165 930 165' },
  { to: NODE.review, d: 'M870 415 C900 415 900 165 930 165' },
  { to: NODE.publish, d: 'M1050 280 L1050 350' },
]

/** Visuals and copy run side by side, so they share a step. */
const STEPS: PipelineNode[][] = [
  [NODE.release],
  [NODE.spec],
  [NODE.plan],
  [NODE.visuals, NODE.copy],
  [NODE.review],
  [NODE.publish],
]

/** The review step lingers: it is the one that waits for a person. */
const STEP_MS = [1300, 1500, 1500, 2000, 2600, 1600]
const HOLD_MS = 3200

const stepOf = (node: PipelineNode) => STEPS.findIndex((nodes) => nodes.includes(node))

function useRunStep(): number {
  const reduce = useHydratedReducedMotion()
  const [step, setStep] = useState(0)
  useEffect(() => {
    if (reduce) return
    const timer = setTimeout(
      () => setStep((current) => (current >= STEPS.length ? 0 : current + 1)),
      step >= STEPS.length ? HOLD_MS : STEP_MS[step]
    )
    return () => clearTimeout(timer)
  }, [reduce, step])
  return reduce ? STEPS.length : step
}

function statusFor(node: PipelineNode, step: number): NodeStatus {
  const index = stepOf(node)
  if (index < step) return STATUS.done
  if (index === step) return STATUS.active
  return STATUS.pending
}

function StatusDot({ status, size }: { status: NodeStatus; size: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center rounded-full',
        status === STATUS.done && 'bg-emerald-400',
        status === STATUS.active && 'bg-white',
        status === STATUS.pending && 'border border-white/25'
      )}
      style={{ height: size, width: size }}
    >
      {status === STATUS.active ? (
        <span className="absolute inset-0 animate-ping rounded-full bg-white/60" />
      ) : null}
    </span>
  )
}

function Row({
  children,
  label,
  mono = false,
}: {
  children: ReactNode
  label: string
  mono?: boolean
}) {
  return (
    <div className="flex items-center justify-between" style={{ gap: u(10) }}>
      <span className="truncate text-white/45">{label}</span>
      <span className={cn('truncate text-white/80', mono && MONO)}>{children}</span>
    </div>
  )
}

function CanvasNode({
  children,
  node,
  status,
  tag,
  title,
}: {
  children: ReactNode
  node: PipelineNode
  status: NodeStatus
  tag: string
  title: string
}) {
  const box = BOXES[node]
  const style: CSSProperties = {
    borderRadius: u(12),
    fontSize: u(12.5),
    gap: u(10),
    height: `${(box.h / H) * 100}%`,
    left: `${(box.x / W) * 100}%`,
    padding: u(14),
    top: `${(box.y / H) * 100}%`,
    width: `${(box.w / W) * 100}%`,
  }
  return (
    <div
      className={cn(
        'absolute flex flex-col overflow-hidden border bg-[#141414] transition-[border-color,opacity,box-shadow] duration-500',
        status === STATUS.active &&
          'border-white/45 shadow-[0_0_0_4px_rgba(255,255,255,0.05),0_20px_50px_-12px_rgba(0,0,0,0.9)]',
        status === STATUS.done && 'border-white/[0.14]',
        status === STATUS.pending && 'border-white/[0.07] opacity-55'
      )}
      style={style}
    >
      <div className="flex items-center justify-between" style={{ gap: u(8) }}>
        <span
          className="flex min-w-0 items-center text-white"
          style={{ fontSize: u(14), gap: u(8) }}
        >
          <StatusDot size={u(8)} status={status} />
          <span className="truncate">{title}</span>
        </span>
        <Tag invert={status === STATUS.active}>{tag}</Tag>
      </div>
      <div className="flex flex-1 flex-col" style={{ gap: u(8) }}>
        {children}
      </div>
    </div>
  )
}

function Thumb({ tone }: { tone: string }) {
  return (
    <div
      className="relative overflow-hidden"
      style={{ aspectRatio: '16/9', background: tone, borderRadius: u(6) }}
    >
      <div
        className="absolute border border-black/20 bg-[#f4f4f4] shadow-lg"
        style={{ borderRadius: u(3), inset: `22% 14% -10% 14%` }}
      >
        <div className="h-[18%] border-b border-black/10 bg-white" />
        <div className="mx-[10%] mt-[10%] h-[8%] w-1/2 rounded-sm bg-black/70" />
        <div className="mx-[10%] mt-[6%] h-[6%] w-3/4 rounded-sm bg-black/15" />
      </div>
    </div>
  )
}

/** Desktop board: the full graph with animated edges. */
function Board({ step }: { step: number }) {
  const reduce = useHydratedReducedMotion()
  const s = (node: PipelineNode) => statusFor(node, step)
  return (
    <div
      className="relative hidden w-full lg:block"
      style={{
        aspectRatio: `${W} / ${H}`,
        backgroundImage: 'radial-gradient(rgba(255,255,255,0.075) 1px, transparent 1px)',
        backgroundSize: u(22) + ' ' + u(22),
        containerType: 'inline-size',
      }}
    >
      <svg
        aria-hidden="true"
        className="absolute inset-0 h-full w-full"
        fill="none"
        viewBox={`0 0 ${W} ${H}`}
      >
        {EDGES.map((edge) => {
          const status = s(edge.to)
          return (
            <g key={edge.d}>
              <path
                d={edge.d}
                stroke={status === STATUS.done ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.13)'}
                strokeWidth={1.5}
              />
              {status === STATUS.active && !reduce ? (
                <>
                  <motion.path
                    animate={{ strokeDashoffset: [0, -28] }}
                    d={edge.d}
                    stroke="white"
                    strokeDasharray="6 8"
                    strokeWidth={1.5}
                    transition={{ duration: 0.7, ease: 'linear', repeat: Infinity }}
                  />
                  <circle fill="white" r={3.5}>
                    <animateMotion dur="1.1s" path={edge.d} repeatCount="indefinite" />
                  </circle>
                </>
              ) : null}
            </g>
          )
        })}
      </svg>

      <CanvasNode node={NODE.release} status={s(NODE.release)} tag="Trigger" title="Release">
        <span className="text-white" style={{ fontSize: u(15) }}>
          Recurring invoices
        </span>
        <span className={cn(MONO, 'text-white/45')} style={{ fontSize: u(11) }}>
          github · release.published
        </span>
        <div className="mt-auto flex flex-wrap" style={{ gap: u(5) }}>
          {['brief', 'S1 PR #452', 'S2 changelog', 'S3 docs'].map((source) => (
            <span
              className={cn(MONO, 'rounded bg-white/[0.06] text-white/60')}
              key={source}
              style={{ fontSize: u(10.5), padding: `${u(2)} ${u(6)}` }}
            >
              {source}
            </span>
          ))}
        </div>
      </CanvasNode>

      <CanvasNode node={NODE.spec} status={s(NODE.spec)} tag="AI" title="Launch brief">
        <Row label="Sections">11</Row>
        <Row label="Claims cited" mono>
          14 / 14
        </Row>
        <div className="overflow-hidden rounded-full bg-white/[0.08]" style={{ height: u(4) }}>
          <div
            className="h-full rounded-full bg-emerald-400 transition-[width] duration-700"
            style={{ width: s(NODE.spec) === STATUS.pending ? '0%' : '100%' }}
          />
        </div>
        <div className="mt-auto flex items-center text-amber-200/80" style={{ gap: u(6) }}>
          <span className="rounded-full bg-amber-300" style={{ height: u(6), width: u(6) }} />1 open
          question for you
        </div>
      </CanvasNode>

      <CanvasNode node={NODE.plan} status={s(NODE.plan)} tag="AI" title="Campaign plan">
        <Row label="Angles">3</Row>
        <Row label="Channels">6</Row>
        <div className="mt-auto grid grid-cols-3" style={{ gap: u(4) }}>
          {['Teaser', 'Launch', 'Follow-up'].map((phase, index) => (
            <div
              className={cn(
                'text-center',
                index === 1 ? 'bg-white text-black' : 'bg-white/[0.06] text-white/60'
              )}
              key={phase}
              style={{ borderRadius: u(5), fontSize: u(10.5), padding: `${u(5)} 0` }}
            >
              {phase}
            </div>
          ))}
        </div>
      </CanvasNode>

      <CanvasNode node={NODE.visuals} status={s(NODE.visuals)} tag="AI" title="Visuals">
        <div className="grid grid-cols-2" style={{ gap: u(6) }}>
          <Thumb tone="linear-gradient(135deg,#2a2a2a,#8a8a8a)" />
          <Thumb tone="linear-gradient(135deg,#d9d9d9,#6d6d6d)" />
          <Thumb tone="linear-gradient(135deg,#4b4b4b,#151515)" />
          <Thumb tone="linear-gradient(135deg,#9a9a9a,#e8e8e8)" />
        </div>
        <Row label="Brand kit">Acme v3</Row>
        <Row label="Checks" mono>
          4 / 4 pass
        </Row>
      </CanvasNode>

      <CanvasNode node={NODE.copy} status={s(NODE.copy)} tag="AI" title="Posts">
        <Row label="X" mono>
          241 / 280
        </Row>
        <Row label="LinkedIn" mono>
          1,104
        </Row>
        <Row label="Instagram" mono>
          412 / 2,200
        </Row>
        <Row label="Product Hunt" mono>
          248 / 260
        </Row>
        <Row label="Changelog, email">entry + email</Row>
        <div className="mt-auto flex items-center text-emerald-300/90" style={{ gap: u(6) }}>
          <span className="rounded-full bg-emerald-400" style={{ height: u(6), width: u(6) }} />
          Copy checks passed · claims cited
        </div>
      </CanvasNode>

      <CanvasNode node={NODE.review} status={s(NODE.review)} tag="Human" title="Review">
        <span className="text-white" style={{ fontSize: u(15) }}>
          6 posts ready
        </span>
        <span className="text-white/45">
          {s(NODE.review) === STATUS.done
            ? 'Approved by you, 1 audit entry'
            : 'Waiting for your approval'}
        </span>
        <div className="mt-auto flex" style={{ gap: u(6) }}>
          <span
            className={cn(
              'flex-1 text-center font-medium transition-colors duration-300',
              s(NODE.review) === STATUS.pending
                ? 'bg-white/10 text-white/50'
                : 'bg-white text-black'
            )}
            style={{ borderRadius: u(999), fontSize: u(12), padding: `${u(7)} 0` }}
          >
            Approve all 6
          </span>
          <span
            className="border border-white/15 text-center text-white/60"
            style={{ borderRadius: u(999), fontSize: u(12), padding: `${u(7)} ${u(10)}` }}
          >
            Changes
          </span>
        </div>
      </CanvasNode>

      <CanvasNode node={NODE.publish} status={s(NODE.publish)} tag="Scheduler" title="Schedule">
        <Row label="Tue 09:00" mono>
          X
        </Row>
        <Row label="Tue 10:30" mono>
          LinkedIn
        </Row>
        <Row label="Wed 09:00" mono>
          Instagram
        </Row>
        <span className={cn(MONO, 'mt-auto text-white/40')} style={{ fontSize: u(10.5) }}>
          published = network confirmed
        </span>
      </CanvasNode>
    </div>
  )
}

const MOBILE_STEPS: { node: PipelineNode; tag: string; title: string; detail: string }[] = [
  { node: NODE.release, tag: 'Trigger', title: 'Release', detail: 'Recurring invoices · PR #452' },
  { node: NODE.spec, tag: 'AI', title: 'Launch brief', detail: '14 of 14 claims cited' },
  { node: NODE.plan, tag: 'AI', title: 'Campaign plan', detail: '3 angles · 6 channels' },
  {
    node: NODE.visuals,
    tag: 'AI',
    title: 'Visuals',
    detail: '4 on-brand visuals · checks passed',
  },
  {
    node: NODE.copy,
    tag: 'AI',
    title: 'Posts',
    detail: 'X, LinkedIn, Instagram, Product Hunt, changelog, email',
  },
  { node: NODE.review, tag: 'Human', title: 'Review', detail: 'Approve all 6 posts in one click' },
  {
    node: NODE.publish,
    tag: 'Scheduler',
    title: 'Schedule',
    detail: 'Published once, with confirmation',
  },
]

/** Mobile list: the same run, stacked. */
function Stack({ step }: { step: number }) {
  return (
    <ol className="relative flex flex-col gap-2 p-3 lg:hidden">
      {MOBILE_STEPS.map((item) => {
        const status = statusFor(item.node, step)
        return (
          <li
            className={cn(
              'flex items-center gap-3 rounded-xl border bg-[#141414] px-3.5 py-3 transition-[border-color,opacity] duration-500',
              status === STATUS.active ? 'border-white/40' : 'border-white/[0.08]',
              status === STATUS.pending && 'opacity-55'
            )}
            key={item.node}
          >
            <StatusDot size="8px" status={status} />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-white">{item.title}</p>
              <p className="truncate text-[13px] text-white/45">{item.detail}</p>
            </div>
            <Tag invert={status === STATUS.active}>{item.tag}</Tag>
          </li>
        )
      })}
    </ol>
  )
}

/**
 * The release-to-launch pipeline as a live workflow canvas: a looping,
 * illustrative run from release intake to a scheduled, approved post.
 */
export function PipelineCanvas() {
  const step = useRunStep()
  return (
    <div
      aria-label="A release moving through launch brief, plan, visuals, posts, review, and schedule"
      role="img"
    >
      <Board step={step} />
      <Stack step={step} />
    </div>
  )
}
