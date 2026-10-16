'use client'

import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { z } from 'zod'
import { cn } from '@/lib/utils'
import { MONO } from '../primitives'

/** The one easing curve every diagram transition uses. */
export const EASE = [0.2, 0.8, 0.2, 1] as const

/** Shared highlight transition: short, eased out, interruptible. */
export const TRANSITION = { duration: 0.32, ease: EASE }

/** Mono uppercase label used for kickers, ids, and status words. */
export const LABEL = cn(MONO, 'text-[10.5px] uppercase tracking-[0.06em]')

/** Accent a diagram element takes when highlighted. */
export const diagramToneSchema = z.enum(['neutral', 'success', 'attention', 'failure'])

/** Accent a diagram element takes when highlighted. */
export type DiagramTone = z.infer<typeof diagramToneSchema>

/** Tone values, for `tone={TONE.attention}` without magic strings. */
export const TONE = diagramToneSchema.enum

/** RGB triples: white, emerald-400, amber-400, red-400. */
const RGB: Record<DiagramTone, string> = {
  neutral: '255, 255, 255',
  success: '52, 211, 153',
  attention: '251, 191, 36',
  failure: '248, 113, 113',
}

/** A tone as an rgba() string, for motion color animation. */
export const toneColor = (tone: DiagramTone, alpha = 1) => `rgba(${RGB[tone]}, ${alpha})`

const TAG_TONE: Record<DiagramTone, string> = {
  neutral: 'bg-white/[0.07] text-white/60',
  success: 'bg-emerald-400/10 text-emerald-400',
  attention: 'bg-amber-400/10 text-amber-400',
  failure: 'bg-red-400/10 text-red-400',
}

/** A small mono tag in a tone, the colored sibling of the primitives Tag. */
export function ToneTag({
  children,
  tone = TONE.neutral,
}: {
  children: ReactNode
  tone?: DiagramTone
}) {
  return (
    <span
      className={cn(
        LABEL,
        'inline-flex h-5 shrink-0 items-center rounded-[5px] px-1.5',
        TAG_TONE[tone]
      )}
    >
      {children}
    </span>
  )
}

/**
 * A diagram node. `lit` means the run has reached it (dim before that);
 * `current` gives it a bright border in its tone.
 */
export function Box({
  children,
  className,
  current = false,
  lit = true,
  tone = TONE.neutral,
}: {
  children: ReactNode
  className?: string
  current?: boolean
  lit?: boolean
  tone?: DiagramTone
}) {
  const border = current
    ? toneColor(tone, tone === TONE.neutral ? 0.5 : 0.75)
    : lit
      ? toneColor(tone, tone === TONE.neutral ? 0.12 : 0.3)
      : '#212121'
  return (
    <motion.div
      animate={{ borderColor: border, opacity: lit ? 1 : 0.4 }}
      className={cn('min-w-0 rounded-xl border bg-[#111] p-3.5', className)}
      initial={false}
      transition={TRANSITION}
    >
      {children}
    </motion.div>
  )
}

/** Fades content in once `on`. The content always takes its space, so nothing shifts. */
export function Reveal({
  children,
  className,
  on,
}: {
  children: ReactNode
  className?: string
  on: boolean
}) {
  return (
    <motion.div
      animate={{ opacity: on ? 1 : 0 }}
      className={className}
      initial={false}
      transition={TRANSITION}
    >
      {children}
    </motion.div>
  )
}

/** Which way a connector runs. `responsive` is vertical when stacked, horizontal from md up. */
export const lineAxisSchema = z.enum(['vertical', 'horizontal', 'responsive'])

/** Which way a connector runs. */
export type LineAxis = z.infer<typeof lineAxisSchema>

/** Connector axis values. */
export const AXIS = lineAxisSchema.enum

const LINE_BOX: Record<LineAxis, string> = {
  vertical: 'h-5 w-full',
  horizontal: 'w-full self-stretch',
  responsive: 'h-5 w-full md:h-auto md:self-stretch',
}

const LINE_TRACK: Record<LineAxis, string> = {
  vertical: 'h-full w-px',
  horizontal: 'h-px w-full',
  responsive: 'h-full w-px md:h-px md:w-full',
}

/** A hairline connector that lights up in its tone. */
export function Line({
  axis,
  className,
  lit,
  tone = TONE.neutral,
}: {
  axis: LineAxis
  className?: string
  lit: boolean
  tone?: DiagramTone
}) {
  return (
    <div
      aria-hidden="true"
      className={cn('flex items-center justify-center', LINE_BOX[axis], className)}
    >
      <span className={cn('relative block bg-[#262626]', LINE_TRACK[axis])}>
        <motion.span
          animate={{ opacity: lit ? 1 : 0 }}
          className="absolute inset-0"
          initial={false}
          style={{ backgroundColor: toneColor(tone, tone === TONE.neutral ? 0.5 : 0.8) }}
          transition={TRANSITION}
        />
      </span>
    </div>
  )
}
