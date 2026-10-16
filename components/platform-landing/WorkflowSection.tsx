import type { ReactNode } from 'react'
import { SPEC_SECTIONS } from '@/lib/launch/spec-schema'
import { cn } from '@/lib/utils'
import { ArrowLink } from './blocks'
import { Check, MONO, MUTED, Section, SectionIntro, Stage, Tag, Window } from './primitives'

function Cite({ children }: { children: ReactNode }) {
  return (
    <span
      className={cn(MONO, 'ml-1.5 rounded bg-white/[0.08] px-1 py-px text-[10.5px] text-white/60')}
    >
      {children}
    </span>
  )
}

/** The release form with its signed webhook receipt. */
export function IntakeMock() {
  return (
    <Window meta="Acme Billing" title="New release">
      <div className="space-y-3.5 p-4 text-[13px]">
        <div>
          <p className="text-[#858585]">Release title</p>
          <p className="mt-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white">
            Recurring invoices
          </p>
        </div>
        <div>
          <p className="text-[#858585]">Why it matters</p>
          <p className="mt-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white/85">
            Bill repeat customers without rebuilding the invoice.
          </p>
        </div>
        <div>
          <p className="text-[#858585]">Source links</p>
          <div className={cn(MONO, 'mt-1 space-y-1 text-[11.5px] text-white/70')}>
            <p>github.com/acme/billing/pull/452</p>
            <p>acme.com/changelog/recurring-invoices</p>
          </div>
        </div>
      </div>
      <div
        className={cn(
          MONO,
          'flex items-center justify-between border-t border-white/[0.06] px-4 py-2.5 text-[11px]'
        )}
      >
        <span className="text-white/50">github · release.published</span>
        <span className="text-emerald-300">201 · signature ok</span>
      </div>
    </Window>
  )
}

/** A launch spec with citations and an open question. */
export function SpecMock() {
  return (
    <Window meta="v2 · draft" title="Launch spec">
      <div className="divide-y divide-white/[0.06] text-[13px]">
        <div className="p-4">
          <p className="text-[#858585]">Problem</p>
          <p className="mt-1 text-white/85">
            Finance teams rebuild the same invoice every month.
            <Cite>S1</Cite>
          </p>
        </div>
        <div className="p-4">
          <p className="text-[#858585]">What changed</p>
          <p className="mt-1 text-white/85">
            Invoices repeat on a schedule you set once.
            <Cite>S2</Cite>
            <Cite>brief</Cite>
          </p>
        </div>
        <div className="p-4">
          <p className="flex items-center gap-2 text-amber-200/90">
            <span className="size-1.5 rounded-full bg-amber-300" />
            Open question
          </p>
          <p className="mt-1 text-white/85">How many beta teams used it? No source says.</p>
          <span className="mt-2.5 inline-flex rounded-full bg-white px-3 py-1 text-[12px] font-medium text-black">
            Answer
          </span>
        </div>
      </div>
    </Window>
  )
}

const PLAN = [
  { phase: 'Teaser', items: ['X', 'LinkedIn'] },
  { phase: 'Launch day', items: ['X', 'Product Hunt', 'Email', 'Changelog'] },
  { phase: 'Follow-up', items: ['LinkedIn', 'Instagram'] },
]

/** A campaign plan split into teaser, launch day, and follow-up. */
export function PlanMock() {
  return (
    <Window meta="v1 · approved" title="Campaign plan">
      <div className="grid grid-cols-3 gap-px overflow-hidden rounded-t-xl bg-white/[0.06] text-[12px]">
        {PLAN.map(({ phase, items }) => (
          <div className="bg-[#121212] p-3" key={phase}>
            <p className="text-[#858585]">{phase}</p>
            <div className="mt-2 flex flex-col gap-1.5">
              {items.map((item) => (
                <span className="rounded-md bg-white/[0.06] px-2 py-1 text-white/80" key={item}>
                  {item}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div
        className={cn(
          MONO,
          'space-y-1.5 border-t border-white/[0.06] p-3.5 text-[11px] text-white/60'
        )}
      >
        <p>
          <span className="text-white">A1</span> hero 16:9 · /invoices/recurring · desktop
        </p>
        <p>
          <span className="text-white">A2</span> feature shot 1:1 · schedule modal
        </p>
      </div>
    </Window>
  )
}

/** A miniature of what the creative engine renders: the product, framed, on brand. */
export function CreativeMock({ className }: { className?: string }) {
  return (
    <div
      className={cn('flex flex-col overflow-hidden rounded-lg px-[7%] pt-[6%]', className)}
      style={{ background: 'linear-gradient(140deg, #f2f2f2 0%, #9d9d9d 45%, #2c2c2c 100%)' }}
    >
      <p className="text-[13px] font-medium leading-tight tracking-[-0.02em] text-black">
        Invoices that send themselves
      </p>
      <div className="-mb-2 mt-[5%] flex-1 overflow-hidden rounded-t-md border border-black/20 bg-white shadow-2xl">
        <div className="flex items-center gap-1 border-b border-black/10 bg-[#f5f5f5] px-2 py-1.5">
          <span className="size-1.5 rounded-full bg-black/20" />
          <span className="size-1.5 rounded-full bg-black/20" />
          <span className="size-1.5 rounded-full bg-black/20" />
          <span className="ml-2 h-2 w-1/3 rounded-full bg-black/10" />
        </div>
        <div className="space-y-1.5 p-2.5">
          {['Monthly', 'Quarterly', 'Monthly', 'Yearly'].map((cadence, index) => (
            <div
              className="flex items-center justify-between gap-2 text-[9px] text-black/70"
              key={index}
            >
              <span className="h-1.5 w-1/3 rounded-full bg-black/15" />
              <span className="rounded-full bg-black/[0.06] px-1.5 py-px">{cadence}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** The asset board with critique results. */
export function VisualsMock() {
  return (
    <Window meta="Brand kit · Acme v3" title="Asset board">
      <div className="p-3">
        <CreativeMock className="aspect-[16/10]" />
        <div className="mt-3 flex flex-wrap gap-1.5 text-[11.5px]">
          {['Legible', 'On brand', 'Matches spec'].map((check) => (
            <span
              className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] py-1 pl-1 pr-2.5 text-white/75"
              key={check}
            >
              <Check className="size-4" />
              {check}
            </span>
          ))}
        </div>
      </div>
    </Window>
  )
}

/** An X post with its claim references and guard checks. */
export function CopyMock() {
  return (
    <Window meta="241 / 280" title="X · Launch day">
      <div className="p-4 text-[13.5px] leading-[1.5] text-white/90">
        Stop rebuilding the same invoice every month. Recurring invoices are live in Acme: set the
        schedule once and every cycle sends itself.
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Tag>capabilities.0</Tag>
          <Tag>whatChanged.1</Tag>
        </div>
      </div>
      <div className="grid grid-cols-3 border-t border-white/[0.06] text-[11.5px] text-white/60">
        {['Within limit', 'No hype', 'Known links'].map((guard) => (
          <span className="flex items-center gap-1.5 px-3 py-2.5" key={guard}>
            <Check className="size-4" />
            {guard}
          </span>
        ))}
      </div>
    </Window>
  )
}

const REVIEW = ['X · Teaser', 'LinkedIn · Teaser', 'X · Launch day', 'Product Hunt · Launch day']

/** The review queue with a revision diff and batch approval. */
export function ReviewMock() {
  return (
    <Window meta="7 posts" title="Review">
      <ul className="divide-y divide-white/[0.06] text-[13px]">
        {REVIEW.map((post) => (
          <li className="flex items-center justify-between px-4 py-2.5" key={post}>
            <span className="text-white/85">{post}</span>
            <span className={cn(MONO, 'text-[11px] text-[#858585]')}>READY_FOR_REVIEW</span>
          </li>
        ))}
      </ul>
      <div className={cn(MONO, 'mx-3 rounded-lg bg-black/40 p-3 text-[11.5px] leading-[1.6]')}>
        <p className="text-rose-300/90">- every cycle sends itself.</p>
        <p className="text-emerald-300/90">+ every cycle bills on time, by itself.</p>
      </div>
      <div className="flex gap-2 p-3">
        <span className="flex-1 rounded-full bg-white py-2 text-center text-[13px] font-medium text-black">
          Approve all 7
        </span>
        <span className="rounded-full border border-white/15 px-4 py-2 text-[13px] text-white/70">
          Apply revision
        </span>
      </div>
    </Window>
  )
}

const STEPS: { title: string; body: string; mock: ReactNode }[] = [
  {
    title: 'Start from what you shipped',
    body: 'Give the release a title, a reason it matters, and up to twenty source links: the pull request, the changelog, the docs. Or let a signed GitHub, GitLab, or custom webhook send every release on its own.',
    mock: <IntakeMock />,
  },
  {
    title: 'Check a cited brief',
    body: `The spec drafts ${SPEC_SECTIONS.length} sections, from problem and audience to proof and limitations. Every claim cites the brief or a source. A claim with no source is removed and becomes a question for you. Nothing is invented to fill a gap.`,
    mock: <SpecMock />,
  },
  {
    title: 'Approve a plan, not a pile of posts',
    body: 'Each channel gets a role and a cadence. Each angle maps to a messaging pillar. Each asset names the screen to capture, the device, and the focus. The timeline runs teaser, launch day, follow-up.',
    mock: <PlanMock />,
  },
  {
    title: 'Get visuals from your real product',
    body: 'The visuals agent captures your product pages, frames them in the editor, and applies your brand kit. Every render is critiqued for legibility, brand, and fit with the spec before it moves on.',
    mock: <VisualsMock />,
  },
  {
    title: 'Get copy that cites its claims',
    body: 'Channel-native posts for X, LinkedIn, Instagram, Product Hunt, your changelog, and email. Each post lists the spec claims it relies on. Posts over the limit, full of hype, or linking somewhere unknown are rejected and rewritten.',
    mock: <CopyMock />,
  },
  {
    title: 'Approve in one click. Revise in one more',
    body: 'Approve all seven posts at once or pick three. Ask for a revision on a post, a design, the plan, or a spec section and get a diff with its knock-on updates. Nothing changes until you apply it, and every decision teaches the next run your taste.',
    mock: <ReviewMock />,
  },
]

/** How a release becomes a launch: six stages, each with a product mock. */
export function WorkflowSection() {
  return (
    <Section id="workflow">
      <SectionIntro
        body="Shots runs the launch the way a good team would: understand the change, agree on a plan, make the assets, check the work, then ship it. You approve each stage."
        label="Workflow"
        lead="One release in."
        trail="A reviewed launch out."
      >
        <div className="mt-10">
          <ArrowLink href="/product/launch-intelligence">Explore launch intelligence</ArrowLink>
        </div>
      </SectionIntro>
      <ol className="mt-24 grid gap-x-4 gap-y-16 md:grid-cols-2">
        {STEPS.map((step, index) => (
          <li key={step.title}>
            <Stage className="items-center px-5 py-10 sm:aspect-[5/4] sm:p-12" variant={index}>
              <div className="w-full max-w-[400px]">{step.mock}</div>
            </Stage>
            <p className={cn(MONO, 'mt-7 text-[13px]', MUTED)}>
              {String(index + 1).padStart(2, '0')}
            </p>
            <h3 className="mt-2 text-2xl tracking-[-0.02em] text-white">{step.title}</h3>
            <p className={cn('mt-3 max-w-[560px] text-[17px] leading-[1.55]', MUTED)}>
              {step.body}
            </p>
          </li>
        ))}
      </ol>
    </Section>
  )
}
