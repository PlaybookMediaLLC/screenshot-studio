import Link from 'next/link'
import {
  ArrowRight01Icon,
  GithubIcon,
  GitlabIcon,
  InstagramIcon,
  Linkedin01Icon,
  Mail01Icon,
  NewTwitterIcon,
} from 'hugeicons-react'
import { cn } from '@/lib/utils'
import { FinalCta } from './blocks'
import { CtaLink } from './CtaLink'
import { LandingFooter } from './LandingFooter'
import { LandingNav } from './LandingNav'
import { PipelineCanvas } from './PipelineCanvas'
import { Principles } from './Principles'
import { CONTAINER, ctaToneSchema, MONO, MUTED, Stage, Window } from './primitives'
import {
  ApprovalSection,
  DevelopersSection,
  EngineSection,
  FaqSection,
  GuardrailsSection,
  ProblemSection,
  PricingSection,
  PublishingSection,
  RoadmapSection,
  SecuritySection,
  StatsSection,
} from './sections'
import { WorkflowSection } from './WorkflowSection'

const STACK = [
  { icon: GithubIcon, name: 'GitHub' },
  { icon: GitlabIcon, name: 'GitLab' },
  { icon: NewTwitterIcon, name: 'X' },
  { icon: Linkedin01Icon, name: 'LinkedIn' },
  { icon: InstagramIcon, name: 'Instagram' },
  { icon: Mail01Icon, name: 'Email' },
]

function Hero() {
  return (
    <section className={cn(CONTAINER, 'pt-16 sm:pt-24')}>
      <Link
        className="inline-flex h-8 items-center gap-2 rounded-full border border-[#2a2a2a] pl-1 pr-3 text-[13px] transition-colors hover:border-[#3a3a3a]"
        href="#workflow"
      >
        <span
          className={cn(
            MONO,
            'rounded-full bg-white px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.06em] text-black'
          )}
        >
          New
        </span>
        <span className="text-white">Launch intelligence</span>
        <span className={cn('hidden sm:inline', MUTED)}>
          · from release to cited, on-brand posts
        </span>
        <ArrowRight01Icon aria-hidden="true" className="size-3.5 text-white/60" />
      </Link>

      <div className="mt-8 grid gap-10 lg:grid-cols-[1.3fr_1fr] lg:items-end lg:gap-16">
        <h1 className="text-balance text-[46px] leading-[0.98] tracking-[-0.035em] sm:text-[64px] lg:text-[72px]">
          <span className="block text-white">Turn every release</span>
          <span className={cn('block', MUTED)}>into a launch.</span>
        </h1>
        <div className="lg:pb-2">
          <p className="max-w-[46ch] text-lg leading-[1.5] text-white/65">
            Screenshot Studio reads what you shipped, writes a cited launch brief, designs on-brand
            visuals from your real product, and drafts posts for every channel. Nothing goes out
            until you approve it.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <CtaLink href="/sign-up" label="Get started" location="landing_hero" />
            <CtaLink
              href="/contact"
              label="Request a demo"
              location="landing_hero"
              tone={ctaToneSchema.enum.secondary}
            />
          </div>
        </div>
      </div>

      <Stage className="mt-16 p-3 sm:mt-20 sm:p-10 lg:p-14" variant={0}>
        <Window
          className="w-full"
          meta={<span className={cn(MONO, 'text-[11.5px]')}>launch run · illustrative</span>}
          title={
            <>
              <span className="size-2 rounded-full bg-emerald-400" />
              Acme · Recurring invoices
            </>
          }
        >
          <div className="lg:p-3">
            <PipelineCanvas />
          </div>
        </Window>
      </Stage>

      <div className="mt-10 flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <p className={cn('text-[15px]', MUTED)}>
          Starts where you ship. Ends where your users read.
        </p>
        <ul className="flex flex-wrap items-center gap-x-7 gap-y-3">
          {STACK.map(({ icon: Icon, name }) => (
            <li className="flex items-center gap-2 text-[15px] text-white/55" key={name}>
              <Icon aria-hidden="true" className="size-[18px]" />
              {name}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/**
 * The public marketing page for the platform: release to launch, written in
 * the manner of polar.sh (dark, two-tone, grainy stages) and sim.ai (workflow
 * canvas, hairline grids, oversized finale).
 */
export function PlatformLanding() {
  return (
    <div className="min-h-screen bg-[#090909] font-[family-name:var(--font-geist-sans)] text-white antialiased">
      <LandingNav />
      <main>
        <Hero />
        <StatsSection />
        <ProblemSection />
        <WorkflowSection />
        <EngineSection />
        <ApprovalSection />
        <section className={cn(CONTAINER, 'pb-24 sm:pb-32')}>
          <Principles />
        </section>
        <PublishingSection />
        <GuardrailsSection />
        <DevelopersSection />
        <SecuritySection />
        <RoadmapSection />
        <PricingSection />
        <FaqSection />
        <FinalCta />
      </main>
      <LandingFooter />
    </div>
  )
}
