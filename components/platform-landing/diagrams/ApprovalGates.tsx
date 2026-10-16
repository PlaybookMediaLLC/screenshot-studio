'use client'

import { motion } from 'motion/react'
import { hasPermission, organizationRoles, type Permission } from '@/lib/auth/permissions'
import { campaignPostTransitions } from '@/lib/tenant/campaign-status'
import { cn } from '@/lib/utils'
import { Check, MONO, MUTED } from '../primitives'
import { TONE, TRANSITION } from './flow-parts'
import { StateChip } from './state-parts'
import { useDiagramStep } from './useDiagramStep'

const rolesWith = (permission: Permission) =>
  organizationRoles.filter((role) => hasPermission(role, permission)).join(', ')

/**
 * Mirrors SCHEDULE_CHECKS in pages/ApprovalsPage.tsx, which does not export
 * it. The server side is ScheduleCampaignPost in
 * services/internal/product/campaign_schedule.go.
 */
const SCHEDULE_CHECKS = [
  'The post belongs to your workspace',
  'The post is approved',
  'A visual is attached',
  'The copy is within the length limit',
  'The destination channel is active and yours',
  'The visual itself is approved',
]

/**
 * What the worker reloads at send time, from Repository.Job in
 * services/internal/publishing/repository.go: the creative's approval, its
 * asset, the workspace status, and the channel connection.
 */
const SEND_CHECKS = [
  'The visual is still approved',
  'The workspace is still active',
  'The channel is still connected',
]

/** Mirrors publish:manage on schedulePost in lib/trpc/routers/campaign.ts. */
const SCHEDULE_PERMISSION: Permission = 'publish:manage'

const GATES = [
  {
    title: 'Approval',
    who: `A signed-in teammate with approval rights: ${rolesWith(campaignPostTransitions.approve.permission)}.`,
    checks: ['Signed in, never an API key or the AI', 'Holds approval rights'],
  },
  {
    title: 'Schedule checks',
    who: `A teammate with publishing rights: ${rolesWith(SCHEDULE_PERMISSION)}.`,
    checks: SCHEDULE_CHECKS,
  },
  {
    title: 'Send-time recheck',
    who: 'The delivery worker, just before it calls the network.',
    checks: SEND_CHECKS,
  },
]

/** Running index of each check across all gates, so they tick in one sequence. */
const OFFSETS = GATES.map((_, index) =>
  GATES.slice(0, index).reduce((sum, gate) => sum + gate.checks.length, 0)
)
const TOTAL_CHECKS = GATES.reduce((sum, gate) => sum + gate.checks.length, 0)
/** Step 0 shows nothing ticked; the archived-creative branch lights last. */
const FAILURE_STEP = TOTAL_CHECKS + 1
const COUNT = FAILURE_STEP + 1

const SUMMARY = `Three gates before a post goes out. One: approval, by a signed-in teammate with approval rights. Two: ${SCHEDULE_CHECKS.length} schedule checks: ${SCHEDULE_CHECKS.join('; ')}. Three: the delivery worker rechecks just before sending: ${SEND_CHECKS.join('; ')}. If the creative was archived after approval, the worker moves the post to CANCELLED, sends no request, and writes an audit entry.`

function Tick({ done }: { done: boolean }) {
  return (
    <span aria-hidden="true" className="relative inline-flex size-5 shrink-0">
      <span className="absolute inset-0 rounded-full border border-white/15" />
      <motion.span
        animate={{ opacity: done ? 1 : 0, scale: done ? 1 : 0.9 }}
        className="absolute inset-0"
        initial={false}
        transition={TRANSITION}
      >
        <Check />
      </motion.span>
    </span>
  )
}

/**
 * The three gates a post passes, as lanes: approval by a teammate, the six
 * schedule checks, and the worker's send-time recheck, with the
 * archived-creative branch to CANCELLED plus an audit entry. Checks tick in
 * sequence, gate by gate. Lanes stack below md.
 */
export function ApprovalGates() {
  const { ref, step } = useDiagramStep<HTMLDivElement>(COUNT, 450)
  const failed = step >= FAILURE_STEP
  return (
    <div
      aria-label={SUMMARY}
      className="grid w-full gap-px overflow-hidden rounded-xl border border-[#212121] bg-[#212121] md:grid-cols-3"
      ref={ref}
      role="img"
    >
      {GATES.map((gate, gateIndex) => {
        const offset = OFFSETS[gateIndex]
        const open = step > offset
        const passed = step >= offset + gate.checks.length
        return (
          <div className="flex flex-col bg-[#111] p-5 sm:p-6" key={gate.title}>
            <div className="flex items-center justify-between gap-3">
              <span
                className={cn(MONO, 'text-[10.5px] uppercase tracking-[0.06em]', MUTED)}
              >{`Gate ${gateIndex + 1}`}</span>
              <motion.span
                animate={{ opacity: passed ? 1 : 0 }}
                className={cn(MONO, 'text-[10.5px] uppercase tracking-[0.06em] text-emerald-400')}
                initial={false}
                transition={TRANSITION}
              >
                Passed
              </motion.span>
            </div>
            <motion.h3
              animate={{ opacity: open ? 1 : 0.5 }}
              className="mt-4 text-[18px] tracking-[-0.01em] text-white"
              initial={false}
              transition={TRANSITION}
            >
              {gate.title}
            </motion.h3>
            <p className={cn('mt-1.5 text-[13.5px] leading-[1.45]', MUTED)}>{gate.who}</p>
            <ul className="mt-5 flex flex-col gap-3">
              {gate.checks.map((check, index) => (
                <li className="flex items-start gap-3" key={check}>
                  <Tick done={step > offset + index} />
                  <span className="pt-px text-[14px] leading-[1.4] text-white/85">{check}</span>
                </li>
              ))}
            </ul>
            {gateIndex === GATES.length - 1 ? (
              <>
                <div className="min-h-6 flex-1" />
                <motion.div
                  animate={{
                    borderColor: failed ? 'rgba(248, 113, 113, 0.45)' : 'rgba(33, 33, 33, 1)',
                    opacity: failed ? 1 : 0.45,
                  }}
                  className="flex flex-col gap-3 rounded-lg border bg-[#161616] p-4 pt-3.5"
                  initial={false}
                  transition={TRANSITION}
                >
                  <span
                    className={cn(MONO, 'text-[10.5px] uppercase tracking-[0.06em] text-red-400')}
                  >
                    If it fails
                  </span>
                  <span className="text-[14px] leading-[1.4] text-white/85">
                    Visual archived after approval
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <span aria-hidden="true" className="text-white/40">
                      →
                    </span>
                    <StateChip state="CANCELLED" tone={TONE.neutral} />
                    <span className={cn(MONO, 'text-[11px]', MUTED)}>+ audit entry</span>
                  </span>
                  <span className={cn('text-[13px]', MUTED)}>No request is sent.</span>
                </motion.div>
              </>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
