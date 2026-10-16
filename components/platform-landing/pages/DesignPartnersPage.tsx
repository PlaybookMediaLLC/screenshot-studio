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
          ['Plan', 'priced together'],
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
    <MarketingShell finale={{ lead: 'Shape what ships.', trail: 'Use it first.' }}>
      <PageHero
        body="Launch intelligence is in early access. Design partners run real releases through it, talk directly to the people building it, and decide what it does next."
        eyebrow={{ label: 'Design partners' }}
        lead="Shape the launch platform."
        location="design_partners_hero"
        primary={{ href: '/contact', label: 'Apply now' }}
        secondary={{ href: '/roadmap', label: 'See the roadmap' }}
        trail="Use it before anyone else."
      >
        <HeroStage>
          <PartnerWindow />
        </HeroStage>
      </PageHero>

      <Section>
        <SectionIntro
          body="Early access is a working relationship, not a waitlist."
          label="What you get"
          lead="The platform now."
          trail="A say in what is next."
        />
        <div className="mt-24">
          <TileGrid
            columns={2}
            items={[
              {
                snippet: 'campaign:workflow · on',
                title: 'Launch intelligence on your workspace',
                body: 'Cited specs, plans, visuals, copy, and AI revisions on your real releases.',
              },
              {
                snippet: 'channels · with you',
                title: 'Hands-on setup',
                body: 'We connect your social channels with you and verify the first scheduled posts together.',
              },
              {
                snippet: 'roadmap · your input',
                title: 'Influence on the roadmap',
                body: 'URL onboarding, GitHub change detection, the weekly plan: you help decide the order and the details.',
              },
              {
                snippet: 'pricing · together',
                title: 'A rate agreed with you',
                body: 'Design partners agree their plan and rate with us during the program, while the published plans settle.',
              },
            ]}
          />
        </div>
      </Section>

      <Section>
        <SectionIntro
          body="We measure whether launches go out with minor edits and whether teams come back for the next release. We need your honesty to get both right."
          label="What we ask"
          lead="Real releases."
          trail="Honest feedback."
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
          <PullQuote
            quote="A founder who runs onboarding once and never comes back received a demo, not a product."
            source="RFC 021, measurement"
          />
        </div>
      </Section>

      <Section>
        <SectionIntro label="How it works" lead="Four steps." trail="One real release." />
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
            a: 'Your plan is agreed with you during the program. The editor and the free plan stay free.',
          },
          {
            q: 'What if it is not a fit?',
            a: 'Say so. Your workspace and everything in it stays yours, on the free plan.',
          },
          {
            q: 'Can we self-host as a design partner?',
            a: 'Yes, though the hosted platform is the fastest way to start. Tell us on the call.',
          },
        ]}
      />

      <Section>
        <SectionIntro label="Related" lead="Keep reading." trail="Every part connects." />
        <div className="mt-24">
          <LinkCards paths={['/product/launch-intelligence', '/roadmap', '/principles']} />
        </div>
      </Section>
    </MarketingShell>
  )
}
