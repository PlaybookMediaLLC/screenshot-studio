import { LAUNCH_CREDITS } from '@/lib/billing/plans'
import { cn } from '@/lib/utils'
import {
  FaqBlock,
  HeroStage,
  LinkCards,
  MarketingShell,
  PageHero,
  SplitFeature,
  StatRows,
  TileGrid,
} from '../blocks'
import { formatQuota, priceLabel } from '../pricing'
import { Check, CONTAINER, MUTED, Section, SectionIntro } from '../primitives'
import { CopyMock, IntakeMock, ReviewMock } from '../WorkflowSection'

const BEFORE = [
  'Ship on Tuesday, announce on Friday, if at all',
  'Screenshots from whatever is on your laptop',
  'One post, written at midnight, for one channel',
  'Claims from memory',
]

const AFTER = [
  'Announce the day it ships',
  'Real screens, framed with your brand',
  'Posts for every channel, in your voice',
  'Claims that cite the pull request',
]

/** /solutions/founders: marketing that keeps up with a small team's release cadence. */
export function FoundersPage() {
  return (
    <MarketingShell
      finale={{ lead: 'Create your Shots workspace', trail: 'and send your next release.' }}
    >
      <PageHero
        body="You build the product and answer support email, so the launch post waits for a free afternoon that never comes. Send Shots the release and review a draft instead."
        eyebrow={{ href: '/use-cases', label: 'Founders', parent: 'Solutions' }}
        lead="You already wrote the release notes."
        location="founders_hero"
        trail="Shots turns them into launch posts."
      >
        <HeroStage>
          <div className="grid w-full max-w-[880px] gap-4 md:grid-cols-2">
            <IntakeMock />
            <CopyMock />
          </div>
        </HeroStage>
      </PageHero>

      <section className={cn(CONTAINER, 'py-24 sm:py-32')}>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="border border-[#212121] p-8 sm:p-12">
            <p className={cn('text-[15px]', MUTED)}>Marketing when there is time</p>
            <ul className="mt-8 space-y-4">
              {BEFORE.map((item) => (
                <li
                  className="flex items-center gap-4 text-lg text-white/55 line-through decoration-white/20"
                  key={item}
                >
                  <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-white/25" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-[#111] p-8 sm:p-12">
            <p className={cn('text-[15px]', MUTED)}>Marketing that ships with the code</p>
            <ul className="mt-8 space-y-4">
              {AFTER.map((item) => (
                <li className="flex items-center gap-4 text-lg text-white" key={item}>
                  <Check />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <Section>
        <SectionIntro
          body="The workflow doesn't assume a marketing department. One person can hold every role, and the defaults are set up for that."
          label="Built for one"
          lead="Works for one person"
          trail="holding every role."
        />
        <div className="mt-24">
          <TileGrid
            items={[
              {
                snippet: 'owner = creator + approver + publisher',
                title: 'Approve your own work',
                body: 'Self-approval is allowed by default. Add teammates later and split the roles when you need a second pair of eyes.',
              },
              {
                snippet: 'POST /api/v1/releases',
                title: 'Launch from CI',
                body: 'Send the release from the same pipeline that deploys it, with an idempotency key so a retried build creates one release.',
              },
              {
                snippet: 'Apache 2.0 · no watermark',
                title: 'The editor comes with it',
                body: 'The editor and image tools are included in every plan, with no watermark.',
              },
            ]}
          />
        </div>
      </Section>

      <Section>
        <SectionIntro
          body="Your judgment is the expensive part, so Shots asks for it in three places: answering open questions, approving the plan, and approving the posts."
          label="Your time"
          lead="You make three decisions per launch."
          trail="The AI drafts the rest."
        />
        <div className="mt-24">
          <SplitFeature
            body="Read six posts, fix the one that is off, and approve the rest in one click. Ask for a revision in plain words and apply it from a diff."
            index={0}
            link={{ href: '/use-cases/feature-launches', label: 'See a feature launch' }}
            title="Review a launch in minutes"
          >
            <ReviewMock />
          </SplitFeature>
        </div>
      </Section>

      <section className={cn(CONTAINER, 'pb-24 sm:pb-32')}>
        <div className="grid gap-12 border-t border-[#212121] pt-24 sm:pt-32 lg:grid-cols-2 lg:gap-24">
          <p className="text-balance text-[24px] leading-[1.3] tracking-[-0.015em] text-white sm:text-[30px]">
            Start on Pro with the editor, release intake, and the API.{' '}
            <span className={MUTED}>
              Launch intelligence is in early access for design partners. Pro includes{' '}
              {formatQuota('pro', 'ai:credits:monthly')} AI credits a month, and a launch uses about{' '}
              {LAUNCH_CREDITS}.
            </span>
          </p>
          <StatRows
            stats={[
              {
                value: formatQuota('pro', 'ai:credits:monthly'),
                label: 'AI credits a month on Pro',
              },
              {
                value: formatQuota('pro', 'api:write:minute'),
                label: 'API writes a minute on Pro',
              },
              { value: priceLabel('pro').price, label: `Pro, ${priceLabel('pro').note}` },
            ]}
          />
        </div>
      </section>

      <FaqBlock
        items={[
          {
            q: 'I am not a marketer. Will the copy sound like me?',
            a: 'It learns from what you approve and what you send back. Your edits and notes become examples for the next launch.',
          },
          {
            q: 'Do I need a brand kit first?',
            a: 'No. Shots works without one. Add your colors and fonts when you want every visual on brand.',
          },
          {
            q: 'What does it cost?',
            a: `Pro is ${priceLabel('pro').price} a month and covers the editor, release intake, and the API, with ${formatQuota('pro', 'ai:credits:monthly')} AI credits. Launch intelligence is in early access for design partners on any plan.`,
          },
        ]}
      />

      <Section>
        <SectionIntro
          label="Related"
          lead="Compare plans, apply for early access,"
          trail="or walk through a feature launch."
        />
        <div className="mt-24">
          <LinkCards paths={['/pricing', '/design-partners', '/use-cases/feature-launches']} />
        </div>
      </Section>
    </MarketingShell>
  )
}
