'use client'

import { motion } from 'motion/react'
import { cn } from '@/lib/utils'
import { availabilitySchema, AvailabilityPill, type Availability } from '../blocks'
import { MUTED } from '../primitives'
import { CSS_EASE, FlowArrow, Label, TRANSITION } from './parts'
import { useDiagramStep } from './useDiagramStep'

const AV = availabilitySchema.enum

/** One connection on the hub: its name and whether it ships today. */
export type HubNode = { name: string; status: Availability }

/** Steps: sources, lines in and the hub, lines out, destinations. */
const STEP = { sources: 0, inbound: 1, outbound: 2, destinations: 3 } as const

/** Connector canvas, stretched to the list height. Rows sit at even intervals. */
const VB_W = 72
const VB_H = 600
const HUB_Y = VB_H / 2

const rowY = (index: number, count: number) => ((index + 0.5) / count) * VB_H

function Connectors({
  drawn,
  inbound,
  nodes,
}: {
  drawn: boolean
  inbound: boolean
  nodes: HubNode[]
}) {
  return (
    <svg
      aria-hidden="true"
      className="h-full w-full"
      fill="none"
      preserveAspectRatio="none"
      viewBox={`0 0 ${VB_W} ${VB_H}`}
    >
      {nodes.map((node, index) => {
        const y = rowY(index, nodes.length)
        const [fromY, toY] = inbound ? [y, HUB_Y] : [HUB_Y, y]
        const d = `M0 ${fromY} C${VB_W / 2} ${fromY} ${VB_W / 2} ${toY} ${VB_W} ${toY}`
        const planned = node.status === AV.Planned
        return planned ? (
          <motion.path
            animate={{ opacity: drawn ? 1 : 0 }}
            d={d}
            initial={false}
            key={node.name}
            stroke="rgba(255,255,255,0.16)"
            strokeDasharray="3 4"
            strokeWidth={1}
            transition={TRANSITION}
            vectorEffect="non-scaling-stroke"
          />
        ) : (
          <motion.path
            animate={{ pathLength: drawn ? 1 : 0 }}
            d={d}
            initial={false}
            key={node.name}
            stroke={
              node.status === AV.Available ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.28)'
            }
            strokeWidth={1}
            transition={{ ...TRANSITION, duration: 0.4 }}
            vectorEffect="non-scaling-stroke"
          />
        )
      })}
    </svg>
  )
}

function List({ label, lit, nodes }: { label: string; lit: boolean; nodes: HubNode[] }) {
  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex h-7 items-start">
        <Label>{label}</Label>
      </div>
      {/* No grid gap: each row pads itself, so row centers match the connector math. */}
      <ul className="grid flex-1 auto-rows-fr">
        {nodes.map((node) => (
          <li className="flex py-1" key={node.name}>
            <div
              className={cn(
                'flex w-full items-center justify-between gap-3 rounded-lg border bg-[#111] px-3 py-2.5 transition-[border-color,opacity]',
                CSS_EASE,
                lit ? 'border-[#2a2a2a]' : 'border-[#212121] opacity-50'
              )}
            >
              <span
                className={cn(
                  'truncate text-[13.5px]',
                  node.status === AV.Planned ? MUTED : 'text-white'
                )}
              >
                {node.name}
              </span>
              <AvailabilityPill status={node.status} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

const describe = (nodes: HubNode[]) => nodes.map((n) => `${n.name} (${n.status})`).join(', ')

/**
 * Hub and spoke: where releases come in, Shots in the middle, and where
 * launches land, each connection marked Available, Early access, or Planned.
 */
export function IntegrationsHub({
  intake: INTAKE,
  distribution: DISTRIBUTION,
}: {
  intake: HubNode[]
  distribution: HubNode[]
}) {
  const { ref, step } = useDiagramStep<HTMLDivElement>(STEP.destinations + 1, 700)
  const hubLit = step >= STEP.inbound

  return (
    <div
      aria-label={`Releases come in from ${describe(INTAKE)}. Shots turns them into launches that go out to ${describe(DISTRIBUTION)}.`}
      className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_64px_auto_64px_minmax(0,1fr)] lg:gap-0"
      ref={ref}
      role="img"
    >
      <List label="Intake" lit={step >= STEP.sources} nodes={INTAKE} />

      <div className="hidden flex-col lg:flex">
        <div className="h-7" />
        <div className="flex-1">
          <Connectors drawn={step >= STEP.inbound} inbound nodes={INTAKE} />
        </div>
      </div>
      <FlowArrow className="lg:hidden" lit={hubLit} />

      <div className="flex flex-col">
        <div className="hidden h-7 lg:block" />
        <div className="flex flex-1 items-center justify-center">
          <div
            className={cn(
              'w-full rounded-xl border bg-[#161616] px-6 py-5 text-center transition-[border-color,box-shadow] lg:w-[168px]',
              CSS_EASE,
              hubLit
                ? 'border-white/40 shadow-[0_0_0_4px_rgba(255,255,255,0.04)]'
                : 'border-[#212121]'
            )}
          >
            <p className="text-[20px] tracking-[-0.02em] text-white">Shots</p>
            <Label className="mt-1 block">Release → launch</Label>
          </div>
        </div>
      </div>

      <FlowArrow className="lg:hidden" lit={step >= STEP.outbound} />
      <div className="hidden flex-col lg:flex">
        <div className="h-7" />
        <div className="flex-1">
          <Connectors drawn={step >= STEP.outbound} inbound={false} nodes={DISTRIBUTION} />
        </div>
      </div>

      <List label="Distribution" lit={step >= STEP.destinations} nodes={DISTRIBUTION} />
    </div>
  )
}
