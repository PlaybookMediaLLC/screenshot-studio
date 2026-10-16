'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { MONO, MUTED, Tag } from '../primitives'
import { AXIS, Box, LABEL, Line, Reveal, TONE, ToneTag, type DiagramTone } from './flow-parts'
import { useDiagramStep } from './useDiagramStep'

/**
 * Steps: 0 the post sentence, 1 its claim, 2 the claim's sources, 3 an uncited
 * claim, 4 removed, 5 open question, 6 the answer joins the brief.
 */
const TRACE_CLAIM = 1
const TRACE_SOURCE = 2
const UNCITED = 3
const REMOVED = 4
const QUESTION = 5
const ANSWERED = 6
const COUNT = 7

/** The uncited claim and the question enforceCitations() turns it into (lib/launch/citations.ts). */
const UNCITED_CLAIM = 'Used by 40 beta teams.'
const QUESTION_TEXT = `Can you confirm: ${UNCITED_CLAIM.slice(0, -1)}?`
const QUESTION_REASON = 'The draft stated this without a source it was given.'

function Cell({
  children,
  className,
  current,
  kind,
  id,
  tone = TONE.neutral,
}: {
  children: ReactNode
  className?: string
  current: boolean
  kind: string
  id: ReactNode
  tone?: DiagramTone
}) {
  return (
    <Box className={cn('flex flex-col gap-2', className)} current={current} tone={tone}>
      <p className="flex items-center justify-between gap-2">
        <span className={cn(LABEL, 'text-white/40 md:hidden')}>{kind}</span>
        {id}
      </p>
      {children}
    </Box>
  )
}

const Text = ({ children }: { children: ReactNode }) => (
  <p className="text-[13.5px] leading-[1.5] text-white/85">{children}</p>
)

/** Three-column header, desktop only; stacked cells carry their own kind label. */
const HEADERS = ['Sources', '', 'Launch brief', '', 'X post · Launch day']

/**
 * How a launch claim stays cited: sources (S1…Sn and your trusted brief) back
 * the launch brief's claims, and each post sentence is tagged with the claim
 * it relies on. One sentence is traced back to its claim and sources; then an
 * uncited claim is removed, becomes an open question, and your answer joins
 * the brief as a trusted source.
 */
export function CitationTrail() {
  const { ref, step } = useDiagramStep<HTMLDivElement>(COUNT, 1000)
  const on = (at: number) => step >= at

  return (
    <div
      aria-label={`Sources S1, the pull request, and S2, the changelog, plus your team's brief back the launch brief's claims. The post sentence "Recurring invoices are live in Acme: set the schedule once and every cycle sends itself." is tagged whatChanged.1, the claim "Invoices repeat on a schedule you set once.", which cites S2 and the brief. The claim "${UNCITED_CLAIM}" cites nothing, so it is removed and becomes the open question "${QUESTION_TEXT}" Your answer joins the brief as a trusted source.`}
      className="w-full"
      ref={ref}
      role="img"
    >
      <div className="grid md:grid-cols-[minmax(0,0.85fr)_28px_minmax(0,1fr)_28px_minmax(0,1.2fr)] md:gap-y-3">
        {HEADERS.map((header, index) => (
          <p className={cn(LABEL, 'hidden text-white/45 md:block')} key={index}>
            {header}
          </p>
        ))}

        {/* Row: S1 → problem.0 → sentence one. Shown, not traced. */}
        <Cell current={false} id={<Tag>S1</Tag>} kind="Source">
          <Text>Pull request #452</Text>
          <p className={cn(MONO, 'truncate text-[11px] text-white/40')}>
            github.com/acme/billing/pull/452
          </p>
        </Cell>
        <Line axis={AXIS.responsive} lit={false} />
        <Cell current={false} id={<Tag>problem.0</Tag>} kind="Claim">
          <Text>Finance teams rebuild the same invoice every month.</Text>
          <span className="flex gap-1.5">
            <Tag>S1</Tag>
          </span>
        </Cell>
        <Line axis={AXIS.responsive} lit={false} />
        <Cell current={false} id={<Tag>problem.0</Tag>} kind="Post sentence">
          <Text>Stop rebuilding the same invoice every month.</Text>
        </Cell>

        {/* Row: S2 ← whatChanged.1 ← sentence two. The traced path. */}
        <Cell
          className="mt-8 md:mt-0"
          current={on(TRACE_SOURCE)}
          id={<Tag invert={on(TRACE_SOURCE)}>S2</Tag>}
          kind="Source"
        >
          <Text>Changelog: Recurring invoices</Text>
          <p className={cn(MONO, 'truncate text-[11px] text-white/40')}>
            acme.com/changelog/recurring-invoices
          </p>
        </Cell>
        <Line axis={AXIS.responsive} lit={on(TRACE_SOURCE)} />
        <Cell
          current={on(TRACE_CLAIM)}
          id={<Tag invert={on(TRACE_CLAIM)}>whatChanged.1</Tag>}
          kind="Claim"
        >
          <Text>Invoices repeat on a schedule you set once.</Text>
          <span className="flex gap-1.5">
            <Tag invert={on(TRACE_SOURCE)}>S2</Tag>
            <Tag invert={on(TRACE_SOURCE)}>brief</Tag>
          </span>
        </Cell>
        <Line axis={AXIS.responsive} lit={on(TRACE_CLAIM)} />
        <Cell current id={<Tag invert>whatChanged.1</Tag>} kind="Post sentence">
          <Text>
            Recurring invoices are live in Acme: set the schedule once and every cycle sends itself.
          </Text>
        </Cell>

        {/* Row: brief, and the claim that cites nothing. */}
        <Cell
          className="mt-8 md:mt-0"
          current={on(TRACE_SOURCE)}
          id={<Tag invert={on(TRACE_SOURCE)}>brief</Tag>}
          kind="Source"
          tone={on(ANSWERED) ? TONE.success : TONE.neutral}
        >
          <Text>Your release, as your team wrote it</Text>
          <span className="flex items-center gap-2">
            <ToneTag tone={TONE.success}>Trusted</ToneTag>
            <Reveal className={cn(LABEL, 'text-emerald-400')} on={on(ANSWERED)}>
              + 1 answer
            </Reveal>
          </span>
        </Cell>
        <div aria-hidden="true" className="h-5 md:h-auto" />
        <Cell current={on(UNCITED)} id={<Tag>proofPoints.0</Tag>} kind="Claim" tone={TONE.failure}>
          <p
            className={cn(
              'text-[13.5px] leading-[1.5] text-white/85 line-through transition-[text-decoration-color] duration-300',
              on(REMOVED) ? 'decoration-red-400/80' : 'decoration-transparent'
            )}
          >
            {UNCITED_CLAIM}
          </p>
          <Reveal className="flex items-center gap-2" on={on(UNCITED)}>
            <ToneTag tone={TONE.failure}>Cites nothing</ToneTag>
          </Reveal>
        </Cell>
      </div>

      <div className="mt-8 grid md:grid-cols-[minmax(0,1fr)_28px_minmax(0,1fr)_28px_minmax(0,1fr)_28px_minmax(0,1fr)]">
        <Reveal on={on(REMOVED)}>
          <Box className="h-full" current={step === REMOVED} tone={TONE.failure}>
            <ToneTag tone={TONE.failure}>Removed</ToneTag>
            <p className={cn('mt-2 text-[13px] leading-[1.5]', MUTED)}>
              A claim with no source is not kept as a fact. No post can rely on it.
            </p>
          </Box>
        </Reveal>
        <Line axis={AXIS.responsive} lit={on(QUESTION)} tone={TONE.attention} />
        <Reveal on={on(QUESTION)}>
          <Box className="h-full" current={step === QUESTION} tone={TONE.attention}>
            <ToneTag tone={TONE.attention}>Open question</ToneTag>
            <p className="mt-2 text-[13px] leading-[1.5] text-white/85">{QUESTION_TEXT}</p>
            <p className={cn('mt-1 text-[12px] leading-[1.5]', MUTED)}>{QUESTION_REASON}</p>
          </Box>
        </Reveal>
        <Line axis={AXIS.responsive} lit={on(ANSWERED)} />
        <Reveal on={on(ANSWERED)}>
          <Box className="h-full" current={false}>
            <ToneTag>Your answer</ToneTag>
            <p className="mt-2 text-[13px] leading-[1.5] text-white/85">
              “Yes, 40 teams used it in the beta.”
            </p>
            <p className={cn('mt-1 text-[12px] leading-[1.5]', MUTED)}>From a teammate.</p>
          </Box>
        </Reveal>
        <Line axis={AXIS.responsive} lit={on(ANSWERED)} tone={TONE.success} />
        <Reveal on={on(ANSWERED)}>
          <Box className="h-full" current={step === ANSWERED} tone={TONE.success}>
            <ToneTag tone={TONE.success}>Joins the brief</ToneTag>
            <p className="mt-2 text-[13px] leading-[1.5] text-white/85">
              A trusted source the next draft can cite.
            </p>
            <p className={cn(MONO, 'mt-1 text-[11px] text-white/40')}>cites: brief</p>
          </Box>
        </Reveal>
      </div>
    </div>
  )
}
