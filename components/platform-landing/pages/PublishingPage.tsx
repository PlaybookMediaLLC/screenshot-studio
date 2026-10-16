import {
  InstagramIcon,
  Linkedin01Icon,
  Mail01Icon,
  NewTwitterIcon,
  Share08Icon,
  WorkflowSquare01Icon,
} from 'hugeicons-react'
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

const STATES = [
  ['DRAFT', 'Not scheduled yet.'],
  ['SCHEDULED', 'Waiting for its time. One durable workflow owns the timer and the cancel signal.'],
  ['PROCESSING', 'Claimed by exactly one worker, which checks eligibility again before sending.'],
  ['PUBLISHED', 'The network returned a receipt, stored with the provider post ID.'],
  ['FAILED', 'A definite failure, such as an expired credential. Nothing was published.'],
  ['CANCELLED', 'Cancelled by a publisher, or no longer eligible at send time. No network call.'],
  ['UNKNOWN_DELIVERY', 'The outcome is uncertain. Held for a person, never blindly sent again.'],
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
    body: 'Announcements to consenting subscribers, delivered through Resend.',
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
    body: 'Performance snapshots at the same post age, feeding the next campaign.',
  },
]

function EmailWindow() {
  return (
    <Window meta="announcement" title="Release email">
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
    <MarketingShell finale={{ lead: 'Scheduled once.', trail: 'Published exactly once.' }}>
      <PageHero
        body="Publishing runs on durable workflows. Each post is checked again when it is due, retried safely when a network pushes back, and marked published only when the network confirms it. Social channels are in early access."
        eyebrow={{ href: '/product', label: 'Publishing', parent: 'Product' }}
        lead="Approved posts go out"
        location="publishing_hero"
        trail="once, with a receipt."
      >
        <HeroStage variant={2}>
          <DeliveryLog />
        </HeroStage>
      </PageHero>

      <Section>
        <SectionIntro
          body="A scheduled post has seven states and a clear owner for each transition. Published means confirmed. Anything ambiguous goes to a person."
          label="Lifecycle"
          lead="Seven states."
          trail="No guessing."
        />
        <div className="mt-24">
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
          body="Duplicate posts are worse than late ones. Every rule below exists to make sure a post goes out once, or not at all."
          label="Guarantees"
          lead="Exactly once,"
          trail="in practice."
        />
        <div className="mt-24">
          <TileGrid
            items={[
              {
                snippet: 'post_<id> · one workflow',
                title: 'Survives restarts',
                body: 'Each scheduled post is one durable workflow that owns its timer, its cancel signal, and its retries. A deploy or a crash does not lose it.',
              },
              {
                snippet: 'schedule × 2 → 1 post',
                title: 'Duplicates converge',
                body: 'Scheduling the same post twice converges on one delivery. The hourly recovery loop reuses the same workflow IDs, so it cannot start a second one.',
              },
              {
                snippet: '429 · 500 → retry → 1',
                title: 'Safe retries',
                body: 'Rate limits and server errors are retried into exactly one remote post.',
              },
              {
                snippet: 'approval · asset · workspace · destination',
                title: 'Checked at send time',
                body: 'When a post is due, the worker reloads its approval, asset revision, workspace status, and destination. Private media is signed only then, retries included.',
              },
              {
                snippet: 'CANCELLED · no request',
                title: 'Cancel means cancel',
                body: 'A cancelled post makes no network request. A creative archived after approval cancels the post instead of publishing it.',
              },
              {
                snippet: 'state + audit + outbox',
                title: 'Nothing lost in between',
                body: 'Each state change commits together with its audit entry and outbox event. The outbox drains every minute, and a dead-lettered event can be replayed.',
              },
            ]}
          />
        </div>
      </Section>

      <Section>
        <SectionIntro
          body="The application owns scheduling, state, idempotency, retries, and recovery. A provider owns only the final network call, behind one narrow seam."
          label="Channels"
          lead="Where launches land."
          trail="And what is next."
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
          Connecting a social channel requires two-factor authentication. During early access each
          workspace is bound to its publishing organization with our help.
        </p>
      </Section>

      <Section>
        <SectionIntro
          body="Announcing a release by email is a product capability, not an afterthought. It gets the same durability as social posts, plus consent rules built for bulk sending."
          label="Release email"
          lead="To people who asked."
          trail="Once each."
        />
        <div className="mt-24">
          <SplitFeature
            body="Recipients are resolved at send time, so an unsubscribe between scheduling and delivery is honored. Consent is per organization: leaving one company's announcements never silences another's."
            bullets={[
              'Only approved release documents can be announced',
              'An empty audience is refused, not silently accepted',
              'One-click unsubscribe for Gmail and Yahoo, plus a footer link',
              'Bounces and complaints are suppressed separately from unsubscribes',
              'Delivery is exactly once per address, enforced by the database',
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
            a: 'Rate limits and server errors are retried. A definite failure becomes FAILED. An uncertain outcome becomes UNKNOWN_DELIVERY and waits for a person, so you never get a surprise duplicate.',
          },
          {
            q: 'Is email marketing included?',
            a: 'Release announcements are. Drip sequences and newsletters are not part of the platform.',
          },
        ]}
      />

      <Section>
        <SectionIntro label="Related" lead="Keep reading." trail="Every part connects." />
        <div className="mt-24">
          <LinkCards
            paths={['/product/approvals', '/use-cases/changelog-and-email', '/integrations']}
          />
        </div>
      </Section>
    </MarketingShell>
  )
}
