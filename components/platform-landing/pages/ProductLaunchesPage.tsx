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
    body: 'Build interest before the day. The plan picks the channels and the angle that hint without spoiling.',
  },
  {
    phase: PLAN_PHASE_LABELS.launch,
    body: 'The main event: the listing, the announcement, the changelog, and the email, all on one day and one message.',
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
    <MarketingShell finale={{ lead: 'Launch day,', trail: 'planned like a release.' }}>
      <PageHero
        body="A product launch is a week of coordinated posts, not one tweet. Shots plans it as a timeline, makes the assets in every format, and holds everything for one review before it goes out."
        eyebrow={{ href: '/use-cases', label: 'Product launches', parent: 'Use cases' }}
        lead="A launch plan,"
        location="product_launches_hero"
        trail="not a launch scramble."
      >
        <HeroStage variant={1}>
          <WeekMock />
        </HeroStage>
      </PageHero>

      <Section>
        <SectionIntro
          body="Every campaign plan splits into three phases. Each post knows which phase it belongs to and which spec and plan versions it was written against."
          label="Timeline"
          lead="Teaser, launch day,"
          trail="follow-up."
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
          body="The listing is the one post you cannot edit after the day starts. It is drafted inside Product Hunt's limits and cites the spec like everything else."
          label="Product Hunt"
          lead="A listing that fits,"
          trail="the first time."
        />
        <div className="mt-24">
          <SplitFeature
            body={`Tagline up to ${ph.title.max} characters, description up to ${ph.bodyMax}, and no hashtags. Over-limit drafts are rewritten with the measured overflow before you see them.`}
            bullets={[
              'Drafted from the approved spec and plan',
              'Hype words and your prohibited terms rejected',
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
          body="Every limit the copy agent writes to, read from the same rules that reject over-limit posts."
          label="Every channel"
          lead="Written to fit."
          trail="Checked before saving."
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
          lead="One review"
          trail="for the whole week."
        />
        <div className="mt-24">
          <SplitFeature
            body="Approve every post at once, approve three and send one back with a note, or ask for a revision and apply it from a diff. Whatever you approve stays as approved."
            index={1}
            link={{ href: '/product/approvals', label: 'How approval works' }}
            title="Approve the launch, not each tweet"
          >
            <ReviewMock />
          </SplitFeature>
        </div>
      </Section>

      <FaqBlock
        items={[
          {
            q: 'Can I launch something that is not live yet?',
            a: 'Yes. Describe it in the brief and link what exists. Captures need a public page, so screenshots of unreleased screens need a public staging or demo surface.',
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
        <SectionIntro label="Related" lead="Keep reading." trail="Every part connects." />
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
