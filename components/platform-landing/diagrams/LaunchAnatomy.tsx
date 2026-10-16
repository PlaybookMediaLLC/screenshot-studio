'use client'

import type { ReactNode } from 'react'
import { z } from 'zod'
import { cn } from '@/lib/utils'
import { MUTED, Tag } from '../primitives'
import { CSS_EASE, FlowArrow, Label, STATE, StateDot, stepState, type StepState } from './parts'
import { useDiagramStep } from './useDiagramStep'

/**
 * The objects a launch is made of, in plain names. Each maps to a row of the
 * object table on pages/ProductPage.tsx: Release, ReleaseSpec (launch brief),
 * CampaignPlan, CampaignPost, Design (visuals), ScheduledPost, and AuditLog.
 */
export const launchObjectSchema = z.enum([
  'release',
  'brief',
  'plan',
  'posts',
  'visuals',
  'scheduled',
])

/** One object in the anatomy of a launch. */
export type LaunchObject = z.infer<typeof launchObjectSchema>

const OBJ = launchObjectSchema.enum

/** Illustrative versions. ProductPage: spec and plan are versioned, and posts record both. */
const BRIEF_VERSION = 'v2'
const PLAN_VERSION = 'v1'

/** Step at which each object appears. Posts and visuals are made together. */
const STEP_OF: Record<LaunchObject, number> = {
  release: 0,
  brief: 1,
  plan: 2,
  posts: 3,
  visuals: 3,
  scheduled: 4,
}

/** The last step lights the back-references from each post to its brief and plan. */
const LINK_STEP = 5

const COPY: Record<LaunchObject, { title: string; detail: string }> = {
  release: { title: 'Release', detail: 'Title, why it matters, audience, and source links.' },
  brief: { title: 'Launch brief', detail: 'Cited. Every draft or edit is a new version.' },
  plan: { title: 'Plan', detail: 'Channels, angles, assets, and the timeline.' },
  posts: { title: 'Posts', detail: 'Copy, channel, and the claims it relies on.' },
  visuals: { title: 'Visuals', detail: 'Editable in the Shots editor, with its variant and critique.' },
  scheduled: { title: 'Scheduled post', detail: 'Destination, time, and the confirmation once it posts.' },
}

function Card({
  children,
  object,
  state,
  tag,
}: {
  children?: ReactNode
  object: LaunchObject
  state: StepState
  tag?: ReactNode
}) {
  return (
    <div
      className={cn(
        'flex flex-1 flex-col rounded-xl border bg-[#111] p-4 transition-[border-color,opacity]',
        CSS_EASE,
        state === STATE.active ? 'border-white/40' : 'border-[#212121]',
        state === STATE.pending && 'opacity-45'
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2 text-[14px] text-white">
          <StateDot state={state} />
          <span className="truncate">{COPY[object].title}</span>
        </span>
        {tag}
      </div>
      <p className={cn('mt-2 text-[13px] leading-[1.45]', MUTED)}>{COPY[object].detail}</p>
      {children}
      <span className="mt-auto flex items-center gap-1.5 pt-4">
        <span
          aria-hidden="true"
          className={cn(
            'size-1.5 rounded-full transition-colors',
            CSS_EASE,
            state === STATE.done ? 'bg-emerald-400' : 'bg-white/15'
          )}
        />
        <Label>Audit entry</Label>
      </span>
    </div>
  )
}

/** A vertical stub from a column down to the audit rail, desktop only. */
function Stub({ lit }: { lit: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'absolute left-1/2 top-full hidden h-6 w-px transition-colors lg:block',
        CSS_EASE,
        lit ? 'bg-emerald-400/50' : 'bg-[#212121]'
      )}
    />
  )
}

/**
 * The anatomy of a launch: a release becomes a versioned launch brief, then a
 * plan, then posts and visuals, then scheduled posts. Every post points back to
 * the brief and plan versions it was written from, and every step writes to
 * the audit log.
 */
export function LaunchAnatomy() {
  const { ref, step } = useDiagramStep<HTMLDivElement>(LINK_STEP + 1, 800)
  const state = (object: LaunchObject) => stepState(STEP_OF[object], step)
  const linked = step >= LINK_STEP
  const lit = (object: LaunchObject) => state(object) !== STATE.pending
  const done = (object: LaunchObject) => state(object) === STATE.done

  return (
    <div
      aria-label={`A launch is made of a release, a versioned launch brief, a plan, posts and visuals, and scheduled posts. Each post records the brief ${BRIEF_VERSION} and plan ${PLAN_VERSION} it was written from. Every step writes to the audit log.`}
      ref={ref}
      role="img"
    >
      <div className="flex flex-col gap-2 lg:flex-row lg:items-stretch">
        <div className="relative flex flex-1">
          <Card object={OBJ.release} state={state(OBJ.release)} />
          <Stub lit={done(OBJ.release)} />
        </div>
        <FlowArrow className="lg:rotate-0" lit={lit(OBJ.brief)} />
        <div className="relative flex flex-1">
          <Card
            object={OBJ.brief}
            state={state(OBJ.brief)}
            tag={<Tag invert={linked}>{BRIEF_VERSION}</Tag>}
          />
          <Stub lit={done(OBJ.brief)} />
        </div>
        <FlowArrow className="lg:rotate-0" lit={lit(OBJ.plan)} />
        <div className="relative flex flex-1">
          <Card
            object={OBJ.plan}
            state={state(OBJ.plan)}
            tag={<Tag invert={linked}>{PLAN_VERSION}</Tag>}
          />
          <Stub lit={done(OBJ.plan)} />
        </div>
        <FlowArrow className="lg:rotate-0" lit={lit(OBJ.posts)} />
        <div className="relative flex flex-1 flex-col gap-1.5">
          <Card object={OBJ.posts} state={state(OBJ.posts)}>
            <span className="mt-3 flex flex-wrap items-center gap-1.5">
              <Label className={cn('transition-colors', CSS_EASE, linked && 'text-white')}>
                Written from
              </Label>
              <Tag invert={linked}>brief {BRIEF_VERSION}</Tag>
              <Tag invert={linked}>plan {PLAN_VERSION}</Tag>
            </span>
          </Card>
          <span
            aria-hidden="true"
            className={cn(
              'self-center text-[13px] leading-none transition-colors',
              CSS_EASE,
              lit(OBJ.visuals) ? 'text-white/60' : 'text-white/20'
            )}
          >
            ↕
          </span>
          <Card object={OBJ.visuals} state={state(OBJ.visuals)} />
          <Stub lit={done(OBJ.posts)} />
        </div>
        <FlowArrow className="lg:rotate-0" lit={lit(OBJ.scheduled)} />
        <div className="relative flex flex-1">
          <Card object={OBJ.scheduled} state={state(OBJ.scheduled)} />
          <Stub lit={done(OBJ.scheduled)} />
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-1 rounded-xl border border-[#212121] bg-[#090909] px-4 py-3">
        <Label className="text-white">Audit log</Label>
        <Label>Append-only · actor, request ID, outcome</Label>
      </div>
    </div>
  )
}
