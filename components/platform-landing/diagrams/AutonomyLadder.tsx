'use client'

import { z } from 'zod'
import { cn } from '@/lib/utils'
import { availabilitySchema, AvailabilityPill, type Availability } from '../blocks'
import { MONO, MUTED } from '../primitives'
import { CSS_EASE, FlowArrow, Label } from './parts'
import { useDiagramStep } from './useDiagramStep'

/** Workspace autonomy modes, from least to most autonomous. */
export const autonomyModeSchema = z.enum(['Manual', 'Copilot', 'Autopilot'])

/** One workspace autonomy mode. */
export type AutonomyMode = z.infer<typeof autonomyModeSchema>

const MODE = autonomyModeSchema.enum
const AV = availabilitySchema.enum

/**
 * Status from pages/ApprovalsPage.tsx ("the Copilot and Autopilot modes are
 * designed and written down, not shipped"); descriptions from
 * docs/rfcs/044-autonomy-modes.md and the roadmap in sections.tsx.
 */
const RUNGS: { mode: AutonomyMode; status: Availability; body: string; rise: string }[] = [
  {
    mode: MODE.Manual,
    status: AV.Available,
    body: 'AI creates things when you ask. Nothing proactive.',
    rise: 'sm:mt-16',
  },
  {
    mode: MODE.Copilot,
    status: AV.Planned,
    body: 'AI suggests launches and plans. Every suggestion waits for a person.',
    rise: 'sm:mt-8',
  },
  {
    mode: MODE.Autopilot,
    status: AV.Planned,
    body: 'Publishes only what your approval policies permit. Everything else queues for review.',
    rise: 'sm:mt-0',
  },
]

/**
 * The autonomy ladder: Manual, then Copilot, then Autopilot, under one fixed
 * ceiling. A mode gates triggers and automatic approval; it never widens what
 * a role may do.
 */
export function AutonomyLadder() {
  const { ref, step } = useDiagramStep<HTMLDivElement>(RUNGS.length + 1, 700)
  const ceiling = step >= RUNGS.length

  return (
    <div
      aria-label="Three autonomy modes: Manual, available today; Copilot and Autopilot, planned. A mode gates triggers and automatic approval. It never widens what a role may do."
      ref={ref}
      role="img"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        {RUNGS.map(({ body, mode, rise, status }, index) => {
          const shown = index <= step
          const available = status === AV.Available
          return (
            <div className="contents" key={mode}>
              {index > 0 ? <FlowArrow className="sm:mt-24 sm:rotate-0" lit={shown} /> : null}
              <div
                className={cn(
                  'flex-1 rounded-xl border bg-[#111] p-5 transition-[border-color,opacity]',
                  CSS_EASE,
                  rise,
                  available ? 'border-white/25' : 'border-dashed border-white/15',
                  !shown && 'opacity-40'
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className={cn(MONO, 'text-[11px]', MUTED)}>0{index + 1}</span>
                  <AvailabilityPill status={status} />
                </div>
                <p className="mt-6 text-[20px] tracking-[-0.015em] text-white">{mode}</p>
                <p className={cn('mt-2 text-[14px] leading-[1.5]', MUTED)}>{body}</p>
              </div>
            </div>
          )
        })}
      </div>

      <div
        className={cn(
          'mt-3 flex flex-col gap-1 rounded-xl border px-5 py-4 transition-colors sm:flex-row sm:items-center sm:justify-between sm:gap-6',
          CSS_EASE,
          ceiling ? 'border-emerald-400/30 bg-emerald-400/[0.04]' : 'border-[#212121] bg-[#090909]'
        )}
      >
        <Label className={cn('transition-colors', CSS_EASE, ceiling && 'text-emerald-400')}>
          What a role may do · same in every mode
        </Label>
        <p className="text-[14px] text-white/85">
          A mode gates triggers and automatic approval. It never widens what a role may do.
        </p>
      </div>
    </div>
  )
}
