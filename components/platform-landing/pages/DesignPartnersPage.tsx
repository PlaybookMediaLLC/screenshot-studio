import { cn } from '@/lib/utils'
import {
  FaqBlock,
  HeroStage,
  LinkCards,
  MarketingShell,
  PageHero,
  PullQuote,
  TileGrid,
} from '../blocks'
import { Check, MONO, MUTED, Section, SectionIntro, Window } from '../primitives'

const STEPS = [
  {
    title: 'Apply',
    body: 'Tell us what you build, how often you ship, and where you announce it.',
  },
  { title: 'Talk', body: 'A short call about your release process and the channels that matter.' },
  {
    title: 'Switch it on',
    body: 'We enable launch intelligence on your workspace and connect your channels with you.',
  },
  {
    title: 'Launch together',
    body: 'Run your next real release through it, and tell us what you changed.',
  },
]

const FITS = [
  'You ship a software product every week or two',
  'Your product has public pages worth showing',
  'You announce on X, LinkedIn, Instagram, a changelog, or email',
  'You will say plainly what you rewrote and why',
]

function PartnerWindow() {
  return (
    <Window className="w-full max-w-[520px]" meta="design partner" title="Acme workspace">
      <dl className="divide-y divide-white/[0.06] text-[13px]">
        {[
          ['Launch intelligence', 'enabled'],
          ['Channels', 'connected with you'],
          ['Plan', 'any plan'],
          ['Line to the team', 'direct'],
        ].map(([label, value]) => (
          <div className="flex items-center justify-between gap-4 px-4 py-3" key={label}>
            <dt className="text-[#858585]">{label}</dt>
            <dd className={cn(MONO, 'text-[12px] text-emerald-300')}>{value}</dd>
          </div>
        ))}
      </dl>
    </Window>
  )
}

/** /design-partners: the early access program for launch intelligence. */
export function DesignPartnersPage() {
  return (
    <MarketingShell
      finale={{ lead: 'Have a release coming up?', trail: 'Run it through Shots with us.' }}
    >
      <PageHero
        body="Launch intelligence is the AI that turns a release into a cited launch brief, visuals, and posts. It is in early access. Design partners use it on real releases and help decide what it does next."
        eyebrow={{ label: 'Design partners' }}
        lead="Run your next real release"
        location="design_partners_hero"
        primary={{ href: '/contact', label: 'Apply now' }}
        secondary={{ href: '/roadmap', label: 'See the roadmap' }}
        trail="through launch intelligence, with our help."
      >
        <HeroStage>
          <PartnerWindow />
        </HeroStage>
      </PageHero>

      <Section>
        <SectionIntro
          body="You work with us directly. We set things up with you and read every note you send."
          label="What you get"
          lead="Early access and hands-on setup,"
          trail="plus a vote on the roadmap."
        />
        <div className="mt-24">
          <TileGrid
            columns={2}
            items={[
              {
                snippet: 'campaign:workflow · on',
                title: 'Launch intelligence on your workspace',
                body: 'Cited launch briefs, plans, visuals, posts, and AI revisions on your real releases.',
              },
              {
                snippet: 'channels · with you',
                title: 'Hands-on setup',
                body: 'We connect your social channels with you and verify the first scheduled posts together.',
              },
              {
                snippet: 'roadmap · your input',
                title: 'Influence on the roadmap',
                body: 'URL onboarding, the weekly plan, and demo videos: you help decide the order and the details.',
              },
              {
                snippet: 'pricing · together',
                title: 'Pricing agreed up front',
                body: 'Launch intelligence works on any plan. We agree your plan and rate with you when you join.',
              },
            ]}
          />
        </div>
      </Section>

      <Section>
        <SectionIntro
          body="Design partners help most when they run real launches and tell us exactly what they rewrote."
          label="What we ask"
          lead="Real releases"
          trail="and a plain account of what you changed."
        />
        <div className="mt-24 grid gap-4 lg:grid-cols-2">
          <ul className="space-y-px bg-[#111] p-2">
            {FITS.map((fit) => (
              <li className="flex items-center gap-4 px-4 py-4 text-[16px] text-white" key={fit}>
                <Check />
                {fit}
              </li>
            ))}
          </ul>
          <PullQuote quote="We judge success by two things: launches that go out with minor edits, and teams that come back for the next release." />
        </div>
      </Section>

      <Section>
        <SectionIntro
          label="How it works"
          lead="Apply, talk, switch it on,"
          trail="then launch a real release together."
        />
        <ol className="mt-24 grid gap-px overflow-hidden border border-[#212121] bg-[#212121] md:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, index) => (
            <li className="bg-[#090909] p-8" key={step.title}>
              <span className={cn(MONO, 'text-[13px]', MUTED)}>
                {String(index + 1).padStart(2, '0')}
              </span>
              <h3 className="mt-6 text-xl text-white">{step.title}</h3>
              <p className={cn('mt-2 text-[15px] leading-[1.6]', MUTED)}>{step.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      <FaqBlock
        items={[
          {
            q: 'Does it cost anything?',
            a: 'Yes. Design partners subscribe to a paid plan like every customer, and we agree which plan with you when you join. The editor and image tools are included in every plan.',
          },
          {
            q: 'What if it is not a fit?',
            a: 'Say so. Your workspace and everything in it stays yours.',
          },
          {
            q: 'Can we self-host as a design partner?',
            a: 'Yes, though the hosted platform is the fastest way to start. Tell us on the call.',
          },
        ]}
      />

      <Section>
        <SectionIntro
          label="Related"
          lead="See what you would be testing:"
          trail="launch intelligence, the roadmap, and our principles."
        />
        <div className="mt-24">
          <LinkCards paths={['/product/launch-intelligence', '/roadmap', '/principles']} />
        </div>
      </Section>
    </MarketingShell>
  )
}
