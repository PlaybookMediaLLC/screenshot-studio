'use client'

import { motion } from 'motion/react'
import { cn } from '@/lib/utils'
import { MONO, MUTED } from '../primitives'
import { CSS_EASE, Label, STATE, StateDot, stepState, TRANSITION, type StepState } from './parts'
import { useDiagramStep } from './useDiagramStep'

/** The authorization path every request takes, in order (see SecurityPage). */
const STEPS = [
  'Sign-in checked',
  'Active workspace',
  'You belong to it',
  'Your role',
  'Permission for the action',
  'Workspace is active',
  'Scoped to the workspace',
  'The change',
  'Audit entry',
] as const

/** The change and its audit entry share one transaction (SecurityPage: "written in the same transaction"). */
const TX_START = 7

const LAST = STEPS.length - 1

function Cell({
  className,
  index,
  state,
}: {
  className?: string
  index: number
  state: StepState
}) {
  return (
    <div
      className={cn(
        'relative bg-[#090909] p-4 transition-colors',
        CSS_EASE,
        state === STATE.active && 'bg-[#161616]',
        className
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={cn(MONO, 'text-[11px]', MUTED)}>{String(index + 1).padStart(2, '0')}</span>
        <StateDot state={state} />
      </div>
      <p
        className={cn(
          'mt-5 text-[13.5px] leading-[1.35] text-white transition-opacity',
          CSS_EASE,
          state === STATE.pending && 'opacity-45'
        )}
      >
        {STEPS[index]}
      </p>
    </div>
  )
}

/**
 * The authorization path from the security page: nine checks in a fixed order,
 * with the change and its audit entry bracketed as one transaction. A request
 * dot walks the path; any failed check is a refusal.
 */
export function AuthPath() {
  const { ref, step } = useDiagramStep<HTMLDivElement>(STEPS.length + 1, 520)
  const committed = step > LAST
  const at = Math.min(step, LAST)
  const state = (index: number) => stepState(index, step)

  return (
    <div
      aria-label={`Every request passes ${STEPS.length} checks in order: ${STEPS.join(', ')}. The change and its audit entry are saved together. Any failed check refuses the request.`}
      ref={ref}
      role="img"
    >
      <div className="grid gap-px overflow-hidden rounded-xl border border-[#212121] bg-[#212121] sm:grid-cols-3 lg:grid-cols-9">
        {STEPS.slice(0, TX_START).map((label, index) => (
          <Cell index={index} key={label} state={state(index)} />
        ))}
        <div className="flex flex-col bg-[#090909] sm:col-span-2">
          <div className="px-4 pt-3">
            <Label className={cn('transition-colors', CSS_EASE, committed && 'text-emerald-400')}>
              One transaction
            </Label>
            <div
              className={cn(
                'mt-2 h-1.5 border-x border-t transition-colors',
                CSS_EASE,
                committed ? 'border-emerald-400/60' : 'border-white/20'
              )}
            />
          </div>
          <div className="grid flex-1 grid-cols-2">
            {[TX_START, LAST].map((index) => (
              <Cell
                className={index === LAST ? 'border-l border-[#212121]' : undefined}
                index={index}
                key={index}
                state={state(index)}
              />
            ))}
          </div>
        </div>
      </div>

      <div aria-hidden="true" className="relative mt-3 hidden h-2 lg:block">
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[#212121]" />
        <motion.div
          animate={{ scaleX: (at + 0.5) / STEPS.length }}
          className={cn(
            'absolute inset-x-0 top-1/2 h-px origin-left -translate-y-1/2',
            committed ? 'bg-emerald-400/50' : 'bg-white/40'
          )}
          initial={false}
          transition={TRANSITION}
        />
        <motion.div
          animate={{ x: `${at * 100}%` }}
          className="absolute inset-y-0 left-0 flex items-center justify-center"
          initial={false}
          style={{ width: `${100 / STEPS.length}%` }}
          transition={TRANSITION}
        >
          <span
            className={cn(
              'size-2 rounded-full transition-colors',
              CSS_EASE,
              committed ? 'bg-emerald-400' : 'bg-white'
            )}
          />
        </motion.div>
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span className="flex items-center gap-2">
          <span aria-hidden="true" className="h-px w-6 border-t border-dashed border-red-400/70" />
          <Label className="text-red-400/90">Any check fails: request refused</Label>
        </span>
        <span className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className={cn(
              'size-1.5 rounded-full transition-colors',
              CSS_EASE,
              committed ? 'bg-emerald-400' : 'bg-white/20'
            )}
          />
          <Label className={cn('transition-colors', CSS_EASE, committed && 'text-emerald-400')}>
            Change and audit entry commit together
          </Label>
        </span>
      </div>
    </div>
  )
}
