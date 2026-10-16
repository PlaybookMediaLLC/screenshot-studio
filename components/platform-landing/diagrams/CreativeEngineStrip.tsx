'use client'

import { z } from 'zod'
import { cn } from '@/lib/utils'
import { Check, MONO, MUTED } from '../primitives'
import { CSS_EASE, STATE, StateDot, stepState } from './parts'
import { useDiagramStep } from './useDiagramStep'

/** Creative engine stages, in pipeline order. */
export const creativeStageSchema = z.enum(['capture', 'compose', 'brand', 'render', 'edit'])

/** One creative engine stage. */
export type CreativeStage = z.infer<typeof creativeStageSchema>

const STAGE = creativeStageSchema.enum

/** Titles and details from the Pipeline section of pages/CreativeEnginePage.tsx. */
const STAGES: { stage: CreativeStage; title: string; detail: string }[] = [
  {
    stage: STAGE.capture,
    title: 'Capture the real product',
    detail: 'Every address checked. Near-blank captures rejected.',
  },
  {
    stage: STAGE.compose,
    title: 'Compose it in a frame',
    detail: 'A device or browser frame with a headline.',
  },
  {
    stage: STAGE.brand,
    title: 'Apply the brand',
    detail: 'Brand gradient, text color, and the nearest font.',
  },
  {
    stage: STAGE.render,
    title: 'Render without credentials',
    detail: 'Headless Chromium and a five-minute, one-design token.',
  },
  {
    stage: STAGE.edit,
    title: 'Edit by hand, any time',
    detail: 'Opens in the editor. Saves as PNG, JPEG, or WebP.',
  },
]

/** One asset as it looks after stage `upTo`: each stage adds to the last. */
function Artifact({ upTo }: { upTo: number }) {
  const framed = upTo >= 1
  const branded = upTo >= 2
  const rendered = upTo >= 3
  const editing = upTo >= 4
  return (
    <div
      aria-hidden="true"
      className="relative aspect-[16/10] overflow-hidden rounded-md"
      style={{
        background: branded ? 'linear-gradient(135deg,#2b2b2b 0%,#9a9a9a 100%)' : '#1a1a1a',
      }}
    >
      {framed ? (
        <div
          className={cn(
            'absolute left-[14%] top-[9%] h-[7%] w-[44%] rounded-[2px]',
            branded ? 'bg-white' : 'bg-white/45'
          )}
        />
      ) : null}
      <div
        className={cn(
          'absolute overflow-hidden rounded-[3px] bg-[#e9e9e9]',
          framed ? 'inset-x-[14%] bottom-[-8%] top-[24%] shadow-lg' : 'inset-[12%]'
        )}
      >
        {framed ? (
          <div className="flex h-[16%] items-center gap-[3px] border-b border-black/10 bg-white px-[5%]">
            <span className="size-[4px] rounded-full bg-black/20" />
            <span className="size-[4px] rounded-full bg-black/20" />
            <span className="size-[4px] rounded-full bg-black/20" />
          </div>
        ) : null}
        <div className="mx-[10%] mt-[9%] h-[8%] w-1/2 rounded-sm bg-black/70" />
        <div className="mx-[10%] mt-[6%] h-[6%] w-3/4 rounded-sm bg-black/15" />
        <div className="mx-[10%] mt-[4%] h-[6%] w-2/3 rounded-sm bg-black/15" />
      </div>
      {rendered ? (
        <span
          className={cn(
            MONO,
            'absolute right-[5%] top-[7%] rounded-[3px] bg-black/60 px-1 text-[9px] uppercase tracking-[0.06em] text-white/80'
          )}
        >
          PNG
        </span>
      ) : null}
      {editing ? (
        <div className="absolute inset-x-[11%] bottom-[-4%] top-[20%] rounded-[3px] border border-dashed border-white/80">
          <span className="absolute -left-[3px] -top-[3px] size-[6px] bg-white" />
          <span className="absolute -right-[3px] -top-[3px] size-[6px] bg-white" />
        </div>
      ) : null}
    </div>
  )
}

/**
 * The creative engine as a strip: capture, compose, brand, render, and edit,
 * with one asset taking shape across the five stages.
 */
export function CreativeEngineStrip() {
  const { ref, step } = useDiagramStep<HTMLOListElement>(STAGES.length + 1, 750)

  return (
    <ol
      aria-label={`The creative engine in ${STAGES.length} stages: ${STAGES.map((s) => s.title).join(', ')}.`}
      className="grid gap-px overflow-hidden rounded-xl border border-[#212121] bg-[#212121] md:grid-cols-5"
      ref={ref}
      role="img"
    >
      {STAGES.map(({ detail, stage, title }, index) => {
        const state = stepState(index, step)
        return (
          <li
            className={cn(
              'grid grid-cols-[112px_1fr] gap-4 bg-[#090909] p-4 transition-colors md:flex md:flex-col md:gap-0',
              CSS_EASE,
              state === STATE.active && 'bg-[#161616]'
            )}
            key={stage}
          >
            <div
              className={cn(
                'transition-opacity md:order-last md:mt-5',
                CSS_EASE,
                state === STATE.pending && 'opacity-30'
              )}
            >
              <Artifact upTo={index} />
            </div>
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className={cn(MONO, 'text-[11px]', MUTED)}>
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="flex size-4 items-center justify-center">
                  {state === STATE.done ? <Check className="size-4" /> : <StateDot state={state} />}
                </span>
              </div>
              <p
                className={cn(
                  'mt-3 text-[14px] leading-[1.35] text-white transition-opacity md:mt-5',
                  CSS_EASE,
                  state === STATE.pending && 'opacity-45'
                )}
              >
                {title}
              </p>
              <p className={cn('mt-1.5 text-[13px] leading-[1.45]', MUTED)}>{detail}</p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
