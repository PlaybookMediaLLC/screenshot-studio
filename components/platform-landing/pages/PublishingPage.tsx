import { InstagramLogoIcon as InstagramIcon } from '@phosphor-icons/react/dist/ssr/InstagramLogo'
import { LinkedinLogoIcon as Linkedin01Icon } from '@phosphor-icons/react/dist/ssr/LinkedinLogo'
import { EnvelopeIcon as Mail01Icon } from '@phosphor-icons/react/dist/ssr/Envelope'
import { XLogoIcon as NewTwitterIcon } from '@phosphor-icons/react/dist/ssr/XLogo'
import { ShareIcon as Share08Icon } from '@phosphor-icons/react/dist/ssr/Share'
import { FlowArrowIcon as WorkflowSquare01Icon } from '@phosphor-icons/react/dist/ssr/FlowArrow'
import { cn } from '@/lib/utils'
import {
  AvailabilityPill,
  FaqBlock,
  HeroStage,
  LinkCards,
  MarketingShell,
  PageHero,
  RowTable,
  SplitFeature,
  TileGrid,
  type Availability,
} from '../blocks'
import { MONO, MUTED, Section, SectionIntro, Window } from '../primitives'
import { DeliveryLog } from '../sections'
import { PublishingStates } from '../diagrams/PublishingStates'

const STATES = [
  ['DRAFT', 'Not scheduled yet.'],
  ['SCHEDULED', 'Waiting for its time. One workflow holds the timer and the cancel signal.'],
  ['PROCESSING', 'Claimed by exactly one worker, which checks eligibility again before sending.'],
  ['PUBLISHED', "The network confirmed it. The confirmation is saved with the network's post ID."],
  ['FAILED', 'A definite failure, such as an expired credential. Nothing was published.'],
  ['CANCELLED', 'Cancelled by a publisher, or no longer eligible at send time. No network call.'],
  ['UNKNOWN_DELIVERY', 'The outcome is uncertain. A teammate decides whether to send it again.'],
] as const

const CHANNELS: { name: string; icon: typeof Mail01Icon; status: Availability; body: string }[] = [
  {
    name: 'X',
    icon: NewTwitterIcon,
    status: 'Early access',
    body: 'Scheduled posts with one image. Connection is set up with you.',
  },
  {
    name: 'LinkedIn',
    icon: Linkedin01Icon,
    status: 'Early access',
    body: 'Scheduled posts with one image. Connection is set up with you.',
  },
  {
    name: 'Instagram',
    icon: InstagramIcon,
    status: 'Early access',
    body: 'Through Instagram Login, or Facebook Login with Page selection.',
  },
  {
    name: 'Release email',
    icon: Mail01Icon,
    status: 'Early access',
    body: 'Release emails to subscribers who opted in, delivered through Resend.',
  },
  {
    name: 'Buffer and Post Bridge',
    icon: Share08Icon,
    status: 'Planned',
    body: 'More scheduling destinations behind the same delivery guarantees.',
  },
  {
    name: 'Post analytics',
    icon: WorkflowSquare01Icon,
    status: 'Planned',
    body: 'Performance snapshots at the same post age, feeding the next launch.',
  },
]

function EmailWindow() {
  return (
    <Window meta="consented audience" title="Release email">
      <div className="space-y-3 p-4 text-[13px]">
        <div className="flex justify-between gap-4">
          <span className="text-[#858585]">Subject</span>
          <span className="truncate text-white">Recurring invoices are here</span>
        </div>
        <div className="rounded-lg bg-black/30 p-3 leading-[1.6] text-white/80">
          Set the schedule once and every cycle sends itself. Here is how it works and how to turn
          it on.
        </div>
        <div className={cn(MONO, 'flex justify-between text-[11px] text-white/45')}>
          <span>audience: consented · 1,284</span>
          <span>unsubscribe · one click</span>
        </div>
      </div>
    </Window>
  )
}

/** /product/publishing: delivery states, guarantees, channels, and release email. */
export function PublishingPage() {
  return (
    <MarketingShell
      finale={{
        lead: 'Connect your channels during early access',
        trail: 'and schedule your first approved post.',
      }}
    >
      <PageHero
        body="Pick a time and Shots publishes the post once. Each post is checked again when it is due and retried safely if a network pushes back. It counts as published only when the network confirms it. Social channels are in early access."
        eyebrow={{ href: '/product', label: 'Publishing', parent: 'Product' }}
        lead="Approved posts publish on schedule,"
        location="publishing_hero"
        trail="and each network confirms delivery."
      >
        <HeroStage variant={2}>
          <DeliveryLog />
        </HeroStage>
      </PageHero>

      <Section>
        <SectionIntro
          body="Each state has a clear owner. Published means the network confirmed it. Anything uncertain goes to a teammate."
          label="Lifecycle"
          lead="A scheduled post is always in one of seven states,"
          trail="and you can see which one."
        />
        <div className="mt-24 space-y-12">
          <PublishingStates />
          <RowTable
            caption="Scheduled post states"
            head={['State', 'Meaning']}
            monoLabels
            rows={STATES.map(([state, meaning]) => ({ label: state, cells: [meaning] }))}
          />
        </div>
      </Section>

      <Section>
        <SectionIntro
          body="A duplicate post looks worse than a late one. Every rule below exists to prevent duplicates."
          label="Guarantees"
          lead="A post goes out once"
          trail="or not at all."
        />
        <div className="mt-24">
          <TileGrid
            items={[
              {
                snippet: 'post_<id> · one workflow',
                title: 'Survives restarts',
                body: "Each scheduled post has its own workflow that holds its timer, cancel signal, and retries. A deploy or a crash doesn't lose it.",
              },
              {
                snippet: 'schedule × 2 → 1 post',
                title: 'No double posts',
                body: "Scheduling the same post twice still sends it once. The hourly recovery check reuses the same workflow IDs, so it can't start a second one.",
              },
              {
                snippet: '429 · 500 → retry → 1',
                title: 'Safe retries',
                body: 'Rate limits and server errors are retried into exactly one remote post.',
              },
              {
                snippet: 'approval · asset · workspace · destination',
                title: 'Checked at send time',
                body: 'When a post is due, Shots reloads its approval, visual, workspace status, and destination. Private media gets a signed link only then, retries included.',
              },
              {
                snippet: 'CANCELLED · no request',
                title: 'Cancel means cancel',
                body: 'A cancelled post makes no network request. Archiving a visual after approval cancels its post.',
              },
              {
                snippet: 'state + audit + event',
                title: 'Nothing lost in between',
                body: 'Each state change is saved together with its audit entry and a queued event. Queued events are sent every minute, and any that fail can be replayed.',
              },
            ]}
          />
        </div>
      </Section>

      <Section>
        <SectionIntro
          body="Shots handles scheduling, state, retries, and recovery. Each network only receives the final call."
          label="Channels"
          lead="X, LinkedIn, Instagram, and email today,"
          trail="with more destinations planned."
        />
        <ul className="mt-24 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CHANNELS.map(({ body, icon: Icon, name, status }) => (
            <li className="flex flex-col bg-[#111] p-7" key={name}>
              <div className="flex items-start justify-between">
                <Icon aria-hidden="true" className="size-6 text-white" />
                <AvailabilityPill status={status} />
              </div>
              <h3 className="mt-10 text-xl text-white">{name}</h3>
              <p className={cn('mt-2 text-[15px] leading-[1.55]', MUTED)}>{body}</p>
            </li>
          ))}
        </ul>
        <p className={cn('mt-8 max-w-[760px] text-[15px] leading-[1.6]', MUTED)}>
          Connecting a social channel requires two-factor authentication. During early access, we
          connect each workspace to its publishing account with you.
        </p>
      </Section>

      <Section>
        <SectionIntro
          body="Release email is built for bulk sending to subscribers who opted in."
          label="Release email"
          lead="Release email has consent rules built in"
          trail="and the same delivery guarantees as posts."
        />
        <div className="mt-24">
          <SplitFeature
            body="Recipients are looked up at send time, so an unsubscribe between scheduling and sending is honored. Consent is per workspace: unsubscribing from one company's emails doesn't affect another's."
            bullets={[
              'Only approved releases can be emailed',
              'An empty audience is refused',
              'One-click unsubscribe for Gmail and Yahoo, plus a footer link',
              'Bounces and complaints are suppressed separately from unsubscribes',
              'Each address gets the email exactly once, enforced by the database',
              'Sends go out in paced batches of 100',
            ]}
            index={0}
            title="Consent first, then delivery"
          >
            <EmailWindow />
          </SplitFeature>
        </div>
      </Section>

      <FaqBlock
        items={[
          {
            q: 'Which networks can I publish to?',
            a: 'X, LinkedIn, and Instagram, in early access. Copy for Product Hunt and your changelog is drafted for you to post.',
          },
          {
            q: 'Can it post threads or carousels?',
            a: 'Not yet. Scheduled posts carry copy and one image.',
          },
          {
            q: 'Can I cancel a scheduled post?',
            a: 'Yes. Anyone with the publisher, admin, or owner role can cancel it before it goes out. A cancelled post makes no network call.',
          },
          {
            q: 'What happens if a network is down?',
            a: "Rate limits and server errors are retried. A definite failure becomes FAILED. An uncertain outcome becomes UNKNOWN_DELIVERY and waits for a teammate, so you don't get a surprise duplicate.",
          },
          {
            q: 'Is email marketing included?',
            a: 'Release emails are. Drip sequences and newsletters are not part of Shots.',
          },
        ]}
      />

      <Section>
        <SectionIntro
          label="Related"
          lead="Read how posts get approved,"
          trail="how release email works, and where Shots connects."
        />
        <div className="mt-24">
          <LinkCards
            paths={['/product/approvals', '/use-cases/changelog-and-email', '/integrations']}
          />
        </div>
      </Section>
    </MarketingShell>
  )
}
