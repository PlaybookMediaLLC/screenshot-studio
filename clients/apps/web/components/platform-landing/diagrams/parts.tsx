'use client'

import type { ReactNode } from 'react'
import { z } from 'zod'
import { cn } from '@/lib/utils'
import { MONO, MUTED } from '../primitives'

/** The diagram easing curve, for motion/react transitions. */
export const TRANSITION = { duration: 0.3, ease: [0.2, 0.8, 0.2, 1] as const }

/** The same curve and duration as Tailwind classes, for CSS transitions. */
export const CSS_EASE = 'duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)]'

/** Where a diagram step stands relative to the current step. */
export const stepStateSchema = z.enum(['pending', 'active', 'done'])

/** Where a diagram step stands relative to the current step. */
export type StepState = z.infer<typeof stepStateSchema>

/** Step state values. */
export const STATE = stepStateSchema.enum

/** The state of step `index` while the diagram shows `step`. */
export function stepState(index: number, step: number): StepState {
  if (index < step) return STATE.done
  return index === step ? STATE.active : STATE.pending
}

/** A mono uppercase diagram label, muted unless a className overrides the color. */
export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn(MONO, 'text-[10.5px] uppercase tracking-[0.06em]', MUTED, className)}>
      {children}
    </span>
  )
}

/** A status dot: outlined when pending, white when active, emerald when done. */
export function StateDot({ state }: { state: StepState }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex size-2 shrink-0 rounded-full transition-colors',
        CSS_EASE,
        state === STATE.done && 'bg-emerald-400',
        state === STATE.active && 'bg-white',
        state === STATE.pending && 'border border-white/25'
      )}
    />
  )
}

/** An arrow between stacked steps; points down by default, add `lg:rotate-0` to point right. */
export function FlowArrow({ className, lit }: { className?: string; lit: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'rotate-90 self-center justify-self-center text-[13px] leading-none transition-colors',
        CSS_EASE,
        lit ? 'text-white/60' : 'text-white/20',
        className
      )}
    >
      →
    </span>
  )
}
