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
import { formatQuota } from '../pricing'
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
    <MarketingShell finale={{ lead: 'You shipped it.', trail: 'Now say so.' }}>
      <PageHero
        body="You build the product, review the pull requests, and answer the support email. The launch post waits for a free afternoon that never comes. Shots drafts it from the release you already wrote."
        eyebrow={{ href: '/use-cases', label: 'Founders', parent: 'Solutions' }}
        lead="You are the engineer, the PM,"
        location="founders_hero"
        trail="and the marketing team."
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
          body="Nothing about the workflow assumes a marketing department. One person can hold every role, and the defaults are built for that."
          label="Built for one"
          lead="A team of one"
          trail="is a team."
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
                snippet: 'Apache 2.0 · free',
                title: 'The editor is free',
                body: 'The screenshot editor and its tools cost nothing, on a free workspace, with no watermark.',
              },
            ]}
          />
        </div>
      </Section>

      <Section>
        <SectionIntro
          body="Your judgment is the expensive part, so the workflow asks for it only where it matters: answering open questions, approving the plan, and approving the posts."
          label="Your time"
          lead="Three decisions."
          trail="Everything else is drafted."
        />
        <div className="mt-24">
          <SplitFeature
            body="Read seven posts, fix the one that is off, and approve the rest in one click. Ask for a revision in plain words and apply it from a diff."
            index={0}
            link={{ href: '/use-cases/feature-launches', label: 'See a feature launch' }}
            title="Review in minutes, not an afternoon"
          >
            <ReviewMock />
          </SplitFeature>
        </div>
      </Section>

      <section className={cn(CONTAINER, 'pb-24 sm:pb-32')}>
        <div className="grid gap-12 border-t border-[#212121] pt-24 sm:pt-32 lg:grid-cols-2 lg:gap-24">
          <p className="text-balance text-[24px] leading-[1.3] tracking-[-0.015em] text-white sm:text-[30px]">
            Start on the free plan.{' '}
            <span className={MUTED}>It is enough to run real launches and see if this fits.</span>
          </p>
          <StatRows
            stats={[
              {
                value: formatQuota('free', 'ai:credits:monthly'),
                label: 'AI credits a month on Free',
              },
              {
                value: formatQuota('free', 'api:write:minute'),
                label: 'API writes a minute on Free',
              },
              { value: '$0', label: 'for the editor, forever' },
            ]}
          />
        </div>
      </section>

      <FaqBlock
        items={[
          {
            q: 'I am not a marketer. Will the copy sound like me?',
            a: 'It learns from what you approve and what you send back. Your edits and notes become examples for the next run.',
          },
          {
            q: 'Do I need a brand kit first?',
            a: 'No. Generation works without one. Add your colors and fonts when you want every design on brand.',
          },
          {
            q: 'What does it cost?',
            a: 'The free plan covers the editor and real launches. Launch intelligence is in early access for design partners.',
          },
        ]}
      />

      <Section>
        <SectionIntro label="Related" lead="Keep reading." trail="Every part connects." />
        <div className="mt-24">
          <LinkCards paths={['/pricing', '/design-partners', '/use-cases/feature-launches']} />
        </div>
      </Section>
    </MarketingShell>
  )
}
