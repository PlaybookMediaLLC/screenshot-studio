import { CHANNEL_RULES } from '@/lib/launch/guards'
import {
  ASSET_FORMATS,
  LAUNCH_CHANNEL_LABELS,
  LAUNCH_CHANNELS,
  PLAN_PHASE_LABELS,
} from '@/lib/launch/spec-schema'
import { cn } from '@/lib/utils'
import {
  FaqBlock,
  HeroStage,
  LinkCards,
  MarketingShell,
  PageHero,
  RowTable,
  SplitFeature,
  TileGrid,
} from '../blocks'
import { PostCard, WeekMock } from '../mocks'
import { MONO, Section, SectionIntro } from '../primitives'
import { ReviewMock } from '../WorkflowSection'

const PHASES = [
  {
    phase: PLAN_PHASE_LABELS.teaser,
    body: "Build interest before the day. The plan picks channels and an angle that hint at what's coming.",
  },
  {
    phase: PLAN_PHASE_LABELS.launch,
    body: 'The main event: the listing, the social posts, the changelog, and the release email, all on one day with one message.',
  },
  {
    phase: PLAN_PHASE_LABELS.follow_up,
    body: 'Keep it going with the angles the launch did not use: a capability, a before and after, an FAQ.',
  },
]

/** /use-cases/product-launches: a launch planned as a timeline. */
export function ProductLaunchesPage() {
  const ph = CHANNEL_RULES.product_hunt
  return (
    <MarketingShell
      finale={{ lead: 'Plan your next launch week', trail: 'from a single release.' }}
    >
      <PageHero
        body="A product launch is a week of coordinated posts. Shots plans it as a timeline, makes the visuals in every format, and holds everything for one review before it goes out."
        eyebrow={{ href: '/use-cases', label: 'Product launches', parent: 'Use cases' }}
        lead="Plan a product launch as one timeline:"
        location="product_launches_hero"
        trail="teaser, launch day, and follow-up."
      >
        <HeroStage variant={1}>
          <WeekMock />
        </HeroStage>
      </PageHero>

      <Section>
        <SectionIntro
          body="Each post also records the launch brief and plan versions it was written against."
          label="Timeline"
          lead="Every plan has three phases,"
          trail="and each post knows which one it belongs to."
        />
        <div className="mt-24">
          <TileGrid
            items={PHASES.map((item, index) => ({
              snippet: `phase ${index + 1}`,
              title: item.phase,
              body: item.body,
            }))}
          />
        </div>
      </Section>

      <Section>
        <SectionIntro
          body="You can't edit the listing once launch day starts. Shots drafts it inside Product Hunt's limits and cites the launch brief like every other post."
          label="Product Hunt"
          lead="Your Product Hunt listing"
          trail="fits the limits on the first draft."
        />
        <div className="mt-24">
          <SplitFeature
            body={`Tagline up to ${ph.title.max} characters, description up to ${ph.bodyMax}, and no hashtags. Over-limit drafts are rewritten before you see them.`}
            bullets={[
              'Drafted from the approved launch brief and plan',
              'Hype words and your banned terms fail the copy checks',
              'Links limited to the product and its sources',
            ]}
            index={0}
            title="The listing"
          >
            <PostCard
              body="Set a schedule once and Acme sends the invoice every cycle. Monthly, quarterly, or yearly, with pause and resume."
              channel="product_hunt"
              claims={['summary', 'capabilities.1']}
              title="Acme: invoices that send themselves"
            />
          </SplitFeature>
        </div>
      </Section>

      <Section>
        <SectionIntro
          body="The AI writes to these limits, and the same rules reject any post that runs over."
          label="Every channel"
          lead={`Limits for all ${LAUNCH_CHANNELS.length} channels,`}
          trail="checked before any post is saved."
        />
        <div className="mt-24">
          <RowTable
            caption="Channel limits"
            head={['Channel', 'Body with call to action', 'Formats']}
            rows={LAUNCH_CHANNELS.map((channel) => ({
              label: LAUNCH_CHANNEL_LABELS[channel],
              cells: [
                <span className={cn(MONO, 'text-[13px]')} key="body">
                  {CHANNEL_RULES[channel].bodyMax.toLocaleString('en-US')} chars
                </span>,
                <span className={cn(MONO, 'text-[13px]')} key="formats">
                  {ASSET_FORMATS.join(' · ')}
                </span>,
              ],
            }))}
          />
        </div>
      </Section>

      <Section>
        <SectionIntro
          body="A launch has more than one person on it. Creators shape the posts, an approver signs off on the whole week, and a publisher schedules it."
          label="Review"
          lead="Review the whole launch week"
          trail="in one sitting."
        />
        <div className="mt-24">
          <SplitFeature
            body="Approve every post at once, approve three and send one back with a note, or ask for a revision and apply it from a diff. Approved posts stay as you approved them."
            index={1}
            link={{ href: '/product/approvals', label: 'How approval works' }}
            title="Approve the whole launch at once"
          >
            <ReviewMock />
          </SplitFeature>
        </div>
      </Section>

      <FaqBlock
        items={[
          {
            q: 'Can I launch something that is not live yet?',
            a: 'Yes. Describe it in the release and link what exists. Captures need a public page, so screenshots of unreleased screens need a public staging or demo page.',
          },
          {
            q: 'Can I change the dates?',
            a: 'Yes. The plan sets the phases and a publisher picks the times when scheduling approved posts.',
          },
          {
            q: 'Does it post to Product Hunt for me?',
            a: 'No. The listing copy is drafted for you to paste. Scheduled delivery covers X, LinkedIn, and Instagram in early access.',
          },
        ]}
      />

      <Section>
        <SectionIntro
          label="Related"
          lead="See a smaller feature launch,"
          trail="how visuals are made, and how posts are published."
        />
        <div className="mt-24">
          <LinkCards
            paths={[
              '/use-cases/feature-launches',
              '/product/creative-engine',
              '/product/publishing',
            ]}
          />
        </div>
      </Section>
    </MarketingShell>
  )
}
