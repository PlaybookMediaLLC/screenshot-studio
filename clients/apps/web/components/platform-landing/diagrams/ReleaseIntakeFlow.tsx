'use client'

import { motion } from 'motion/react'
import { z } from 'zod'
import { cn } from '@/lib/utils'
import { MONO, MUTED } from '../primitives'
import {
  AXIS,
  Box,
  LABEL,
  Line,
  Reveal,
  TONE,
  ToneTag,
  TRANSITION,
  toneColor,
  type DiagramTone,
} from './flow-parts'
import { useDiagramStep } from './useDiagramStep'

const laneSchema = z.enum(['form', 'api', 'webhook'])
type Lane = z.infer<typeof laneSchema>

/**
 * A release a member typed is trusted; one from an API key or a webhook has no
 * author on the team (lib/ai/launch/spec.ts origin) and is fenced as untrusted.
 */
const LANES: Record<
  Lane,
  { title: string; detail: string; code: string[]; trust: string; tone: DiagramTone }
> = {
  form: {
    title: 'Release form',
    detail: 'Typed by your team.',
    code: ['title · why it matters · links'],
    trust: 'Trusted',
    tone: TONE.success,
  },
  api: {
    title: 'REST API',
    detail: 'From CI with an API key. A retry with the same key returns 200 with the first result.',
    code: ['POST /api/v1/releases', 'Idempotency-Key'],
    trust: 'Untrusted, fenced',
    tone: TONE.attention,
  },
  webhook: {
    title: 'Signed webhook',
    detail: 'From GitHub, GitLab, or your own pipeline.',
    code: ['X-Shots-Signature'],
    trust: 'Untrusted, fenced',
    tone: TONE.attention,
  },
}

/** Webhook handling in route order: app/api/webhooks/source/[sourceAppId]/route.ts. */
const WEBHOOK_STEPS: {
  title: string
  detail: string
  headers: string[]
  native: string
  branch?: { code: string; text: string; tone: DiagramTone }
}[] = [
  {
    title: 'Verify the signature',
    detail: 'Over the raw body bytes, before anything is parsed.',
    headers: ['X-Shots-Signature', 'X-Shots-Timestamp'],
    native: 'GitHub X-Hub-Signature-256 · GitLab webhook-signature',
    branch: { code: '401', text: 'Bad signature: refused', tone: TONE.failure },
  },
  {
    title: 'Parse the event',
    detail: 'Read the release from the verified body.',
    headers: [],
    native: 'GitHub and GitLab link their release page as a source',
    branch: { code: '202', text: 'Ships nothing: ignored', tone: TONE.neutral },
  },
  {
    title: 'Dedupe the delivery',
    detail: 'Redeliveries are recognized, so a retry cannot create a second release.',
    headers: ['X-Shots-Event-Id'],
    native: 'GitHub X-GitHub-Delivery · GitLab webhook-id',
  },
  {
    title: 'Release created',
    detail: 'One release, ready for launch intelligence.',
    headers: ['201 Created'],
    native: 'Fenced as untrusted for review',
  },
]

const LANE_COUNT = laneSchema.options.length
const REPLAY_STEP = LANE_COUNT + WEBHOOK_STEPS.length
const COUNT = REPLAY_STEP + 1

/** Merge edges from the three equal lane rows (centers at 1/6, 1/2, 5/6) into the release. */
const MERGE_PATHS = [
  'M0 16.67 C24 16.67 24 50 48 50',
  'M0 50 L48 50',
  'M0 83.33 C24 83.33 24 50 48 50',
]

/**
 * Three ways a release comes in, merging into one release: the form (trusted),
 * the REST API with an Idempotency-Key, and a signed webhook (both untrusted,
 * fenced). The webhook lane then expands: verify the signature over the raw
 * body, parse, dedupe the delivery, 201 created; a redelivery answers 200.
 */
export function ReleaseIntakeFlow() {
  const { ref, step } = useDiagramStep<HTMLDivElement>(COUNT, 950)

  return (
    <div
      aria-label="Three ways a release comes in. The release form is typed by your team and trusted. The REST API, POST /api/v1/releases with an Idempotency-Key, and a signed webhook have no author on your team, so their release is fenced as untrusted. All three create the same release. A webhook is handled in order: the signature is verified over the raw body using X-Shots-Signature and X-Shots-Timestamp, or GitHub's X-Hub-Signature-256 and GitLab's webhook-signature, and a bad signature gets 401; the event is parsed, and one that ships nothing gets 202; the delivery is deduplicated by X-Shots-Event-Id, X-GitHub-Delivery, or webhook-id; a new release gets 201. A redelivery gets 200 and still makes one release."
      className="w-full"
      ref={ref}
      role="img"
    >
      <div className="grid md:grid-cols-[minmax(0,1.25fr)_64px_minmax(0,0.75fr)] md:items-center">
        <div className="grid md:grid-rows-3">
          {laneSchema.options.map((lane, index) => {
            const item = LANES[lane]
            return (
              <div className="flex flex-col md:py-1.5" key={lane}>
                {index > 0 ? <Line axis={AXIS.vertical} className="md:hidden" lit={false} /> : null}
                <Box
                  className="flex h-full flex-col justify-between gap-3 sm:flex-row sm:items-start"
                  current={step === index}
                  lit={step >= index}
                  tone={step === index ? TONE.neutral : item.tone}
                >
                  <div className="min-w-0">
                    <p className="text-[14px] text-white">{item.title}</p>
                    <p className={cn('mt-1 text-[13px] leading-[1.5]', MUTED)}>{item.detail}</p>
                    <p
                      className={cn(MONO, 'mt-2 flex flex-wrap gap-x-3 text-[11px] text-white/55')}
                    >
                      {item.code.map((code) => (
                        <span key={code}>{code}</span>
                      ))}
                    </p>
                  </div>
                  <ToneTag tone={item.tone}>{item.trust}</ToneTag>
                </Box>
              </div>
            )
          })}
        </div>

        <Line axis={AXIS.vertical} className="md:hidden" lit />
        <svg
          aria-hidden="true"
          className="hidden h-full w-full md:block md:self-stretch"
          fill="none"
          preserveAspectRatio="none"
          viewBox="0 0 48 100"
        >
          {MERGE_PATHS.map((d, index) => (
            <g key={d}>
              <path d={d} stroke="#262626" strokeWidth={1} vectorEffect="non-scaling-stroke" />
              <motion.path
                animate={{ pathLength: step >= index ? 1 : 0 }}
                d={d}
                initial={false}
                stroke={toneColor(LANES[laneSchema.options[index]].tone, 0.7)}
                strokeWidth={1}
                transition={{ ...TRANSITION, duration: 0.4 }}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          ))}
        </svg>

        <Box current={step < LANE_COUNT} tone={TONE.neutral}>
          <p className={cn(LABEL, 'text-white/45')}>Release</p>
          <p className="mt-2 text-[15px] text-white">Recurring invoices</p>
          <p className={cn('mt-1 text-[13px] leading-[1.5]', MUTED)}>
            Every path lands in the same release, scoped to your workspace.
          </p>
        </Box>
      </div>

      <div className="mt-10">
        <p className={cn(LABEL, 'text-white/45')}>Signed webhook, step by step</p>
        <div className="mt-3 grid md:grid-cols-[minmax(0,1fr)_24px_minmax(0,1fr)_24px_minmax(0,1fr)_24px_minmax(0,1fr)]">
          {WEBHOOK_STEPS.map((item, index) => {
            const at = LANE_COUNT + index
            const last = index === WEBHOOK_STEPS.length - 1
            return [
              index > 0 ? (
                <Line axis={AXIS.responsive} key={`${item.title}-line`} lit={step >= at} />
              ) : null,
              <Box
                className="flex flex-col"
                current={step === at}
                key={item.title}
                lit={step >= at}
                tone={last ? TONE.success : TONE.neutral}
              >
                <p className="flex items-baseline gap-2.5">
                  <span className={cn(LABEL, 'text-white/35')}>
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="text-[14px] text-white">{item.title}</span>
                </p>
                <p className={cn('mt-1.5 text-[13px] leading-[1.5]', MUTED)}>{item.detail}</p>
                <p
                  className={cn(
                    MONO,
                    'mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px]',
                    last ? 'text-emerald-400' : 'text-white/75'
                  )}
                >
                  {item.headers.map((header) => (
                    <span key={header}>{header}</span>
                  ))}
                </p>
                <p className={cn(MONO, 'mt-1 text-[10.5px] leading-[1.6] text-white/40')}>
                  {item.native}
                </p>
                <div className="mt-auto pt-3">
                  {item.branch ? (
                    <span className="flex items-center gap-2 text-[12px] text-white/60">
                      <ToneTag tone={item.branch.tone}>{item.branch.code}</ToneTag>
                      {item.branch.text}
                    </span>
                  ) : null}
                  {last ? (
                    <Reveal
                      className="flex items-center gap-2 text-[12px] text-white/60"
                      on={step >= REPLAY_STEP}
                    >
                      <ToneTag>200</ToneTag>
                      Redelivery: still one release
                    </Reveal>
                  ) : null}
                </div>
              </Box>,
            ]
          })}
        </div>
      </div>
    </div>
  )
}
