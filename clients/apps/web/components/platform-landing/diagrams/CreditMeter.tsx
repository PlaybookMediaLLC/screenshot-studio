'use client'

import { motion } from 'motion/react'
import {
  CREDIT_PACKS,
  getWorkspaceQuota,
  LAUNCH_CREDITS,
  workspacePlanSchema,
  workspaceQuotaSchema,
} from '@/lib/billing/plans'
import { USD_PER_CREDIT } from '@/lib/ai/metering/pricing'
import { cn } from '@/lib/utils'
import { MONO, MUTED } from '../primitives'
import { CSS_EASE, Label, TRANSITION } from './parts'
import { useDiagramStep } from './useDiagramStep'

/** The Pro plan allowance and the extra launch pack, read from the billing code. */
const ALLOWANCE = getWorkspaceQuota(
  workspacePlanSchema.enum.pro,
  workspaceQuotaSchema.enum['ai:credits:monthly']
)
const PACK = CREDIT_PACKS.launch

/** A launch draws the allowance first, then the pack (lib/billing/plans.ts). */
const FROM_ALLOWANCE = Math.min(ALLOWANCE, LAUNCH_CREDITS)
const AFTER_LAUNCH = {
  allowance: ALLOWANCE - FROM_ALLOWANCE,
  pack: Math.max(PACK.credits - (LAUNCH_CREDITS - FROM_ALLOWANCE), 0),
}

/** Remaining allowance and pack credits at each step. */
const LEVELS = [
  { allowance: ALLOWANCE, pack: 0, bought: false },
  { allowance: ALLOWANCE, pack: PACK.credits, bought: true },
  { ...AFTER_LAUNCH, bought: true },
  { allowance: 0, pack: 0, bought: true },
  { allowance: 0, pack: 0, bought: true },
]

/** 3600 → "3,600". */
const fmt = (credits: number) => credits.toLocaleString('en-US')

const LEDGER = [
  {
    delta: `+${fmt(ALLOWANCE)}`,
    title: 'Monthly allowance, Pro plan',
    note: 'Resets on the 1st (UTC)',
  },
  {
    delta: `+${PACK.credits}`,
    title: `Extra launch, ${PACK.price}`,
    note: 'Spent after the allowance. Never expires',
  },
  {
    delta: `−${LAUNCH_CREDITS}`,
    title: 'A launch',
    note: 'Drawn from the allowance first, then the pack',
  },
  {
    delta: `−${fmt(AFTER_LAUNCH.allowance + AFTER_LAUNCH.pack)}`,
    title: 'More launches and AI calls',
    note: 'The balance reaches zero',
  },
]

const REFUSED_STEP = LEVELS.length - 1
const TOTAL = ALLOWANCE + PACK.credits
const cents = Math.round(USD_PER_CREDIT * 100)

function Segment({
  capacity,
  fill,
  outlined,
  remaining,
}: {
  capacity: number
  fill: string
  outlined: boolean
  remaining: number
}) {
  return (
    <div
      className={cn(
        'relative h-full overflow-hidden rounded-full transition-colors',
        CSS_EASE,
        outlined ? 'border border-dashed border-white/20' : 'bg-white/[0.06]'
      )}
      style={{ flexBasis: `${(capacity / TOTAL) * 100}%` }}
    >
      <motion.div
        animate={{ scaleX: remaining / capacity }}
        className={cn('absolute inset-0 origin-left rounded-full', fill)}
        initial={false}
        transition={{ ...TRANSITION, duration: 0.4 }}
      />
    </div>
  )
}

/**
 * How AI credits work: the monthly allowance, an extra launch pack on top, a
 * launch drawing the balance down, and the next AI call refused at zero.
 */
export function CreditMeter() {
  const { ref, step } = useDiagramStep<HTMLDivElement>(LEVELS.length, 1100)
  const level = LEVELS[step]
  const balance = level.allowance + level.pack
  const refused = step === REFUSED_STEP

  return (
    <div
      aria-label={`AI credits: a ${fmt(ALLOWANCE)}-credit monthly Pro allowance, plus an extra launch of ${PACK.credits} credits for ${PACK.price} that never expires. A launch uses about ${LAUNCH_CREDITS}. At zero, the next AI call is refused. The allowance resets on the 1st (UTC). One credit is ${cents} cent of model cost.`}
      className="rounded-xl border border-[#212121] bg-[#111] p-5 sm:p-6"
      ref={ref}
      role="img"
    >
      <div className="flex items-end justify-between gap-4">
        <div>
          <Label>AI credit balance</Label>
          <p
            className={cn(
              MONO,
              'mt-2 text-[32px] leading-none tabular-nums tracking-[-0.02em] transition-colors',
              CSS_EASE,
              refused ? 'text-red-400' : 'text-white'
            )}
          >
            {balance.toLocaleString('en-US')}
          </p>
        </div>
        <span
          className={cn(
            MONO,
            'inline-flex h-6 items-center rounded-full px-2.5 text-[11px] uppercase tracking-[0.04em] transition-[background-color,color,opacity]',
            CSS_EASE,
            refused ? 'bg-red-400/10 text-red-400' : 'bg-white/[0.04] text-transparent opacity-0'
          )}
        >
          Next AI call refused
        </span>
      </div>

      <div className="mt-5 flex h-2.5 gap-1">
        <Segment
          capacity={ALLOWANCE}
          fill="bg-white/80"
          outlined={false}
          remaining={level.allowance}
        />
        <Segment
          capacity={PACK.credits}
          fill="bg-emerald-400"
          outlined={!level.bought}
          remaining={level.pack}
        />
      </div>
      <div className="mt-2 flex gap-1">
        <span style={{ flexBasis: `${(ALLOWANCE / TOTAL) * 100}%` }}>
          <Label>Allowance {fmt(ALLOWANCE)}</Label>
        </span>
        <span style={{ flexBasis: `${(PACK.credits / TOTAL) * 100}%` }}>
          <Label className={cn('transition-colors', CSS_EASE, level.bought && 'text-emerald-400')}>
            Pack {PACK.credits}
          </Label>
        </span>
      </div>

      <ol className="mt-6 divide-y divide-[#212121] border-y border-[#212121]">
        {LEDGER.map((row, index) => (
          <li
            className={cn(
              'grid grid-cols-[64px_1fr] items-baseline gap-x-4 py-2.5 transition-opacity sm:grid-cols-[64px_1fr_auto]',
              CSS_EASE,
              index > step && 'opacity-30'
            )}
            key={row.title}
          >
            <span className={cn(MONO, 'text-[13px] tabular-nums text-white')}>{row.delta}</span>
            <span className="text-[14px] text-white">{row.title}</span>
            <span className={cn('col-start-2 text-[13px] sm:col-start-auto', MUTED)}>
              {row.note}
            </span>
          </li>
        ))}
      </ol>

      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5">
        <Label>1 credit = {cents}¢ of model cost</Label>
        <Label>A launch ≈ {LAUNCH_CREDITS} credits</Label>
        <Label>At zero, refused before the next call</Label>
      </div>
    </div>
  )
}
