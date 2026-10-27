import { hasPermission, type OrganizationRole } from '@/lib/auth/permissions'
import {
  FaqBlock,
  HeroStage,
  LinkCards,
  MarketingShell,
  Mark,
  PageHero,
  RowTable,
  SplitFeature,
  TileGrid,
} from '../blocks'
import { Section, SectionIntro } from '../primitives'
import { BrandWidget } from '../sections'
import { PlanMock, ReviewMock, SpecMock } from '../WorkflowSection'

const TEAM: { role: OrganizationRole; who: string }[] = [
  { role: 'creator', who: 'Product marketers who shape the posts' },
  { role: 'approver', who: 'The lead who signs off' },
  { role: 'publisher', who: 'Whoever owns the calendar' },
  { role: 'viewer', who: 'Sales, support, and leadership' },
]

/** /solutions/product-marketing: a cited launch brief, approvals, and an audit trail. */
export function ProductMarketingPage() {
  return (
    <MarketingShell
      finale={{
        lead: 'Invite your writers and approvers',
        trail: 'and run your next launch in Shots.',
      }}
    >
      <PageHero
        body="Engineering ships, and you find out from the changelog. Shots turns each release into a cited launch brief your whole team can trust. You approve a plan, and the visuals and posts are built to both."
        eyebrow={{ href: '/use-cases', label: 'Product marketing', parent: 'Solutions' }}
        lead="Know what engineering shipped"
        location="product_marketing_hero"
        trail="before you write a word."
      >
        <HeroStage variant={1}>
          <div className="grid w-full max-w-[880px] gap-4 md:grid-cols-2">
            <SpecMock />
            <PlanMock />
          </div>
        </HeroStage>
      </PageHero>

      <Section>
        <SectionIntro
          body="Every claim cites the pull request, the changelog, or the release. Gaps come back to you as questions. Approve one version and every visual and post is built to it."
          label="Launch brief"
          lead="One launch brief per release,"
          trail="with every claim tied to a source."
        />
        <div className="mt-24">
          <TileGrid
            items={[
              {
                snippet: 'messaging · pillars',
                title: 'Positioning, written down',
                body: 'Messaging pillars, positioning against alternatives, and calls to action live in the launch brief, where the whole team can read them.',
              },
              {
                snippet: 'v3 approved · v4 draft',
                title: 'Every version kept',
                body: 'Every AI draft, teammate edit, and applied revision is a new version. You always know which one the posts were written to.',
              },
              {
                snippet: 'beforeAfter · limitations',
                title: 'Honest by structure',
                body: "Limitations have their own section in the launch brief, so the launch can't promise what the release doesn't do.",
              },
            ]}
          />
        </div>
      </Section>

      <Section>
        <SectionIntro
          body="Separate the people who write from the people who sign off and the people who press publish. Each role can read everything and change only its part."
          label="Team"
          lead="Writers, approvers, and publishers"
          trail="each get their own role."
        />
        <div className="mt-24">
          <RowTable
            caption="Team roles"
            head={['Role', 'Who', 'Edit drafts', 'Approve', 'Schedule']}
            monoLabels
            rows={TEAM.map(({ role, who }) => ({
              label: role,
              cells: [
                who,
                <Mark key="edit" value={hasPermission(role, 'artifact:edit')} />,
                <Mark key="approve" value={hasPermission(role, 'release:approve')} />,
                <Mark key="publish" value={hasPermission(role, 'publish:manage')} />,
              ],
            }))}
          />
        </div>
      </Section>

      <Section>
        <SectionIntro
          body="Nobody picks brand colors for each visual, so the brand stays consistent. Every note you leave teaches the next launch."
          label="Quality"
          lead="Your brand kit applies to every visual,"
          trail="and each review improves the next launch."
        />
        <div className="mt-24 space-y-24">
          <SplitFeature
            body="The brand kit is applied to every visual the AI makes: the gradient, the accent, the text color, and the nearest font."
            index={0}
            link={{ href: '/product/creative-engine', label: 'See the creative engine' }}
            title="Brand applied automatically"
          >
            <BrandWidget />
          </SplitFeature>
          <SplitFeature
            body="Approved posts teach it what good looks like. Posts you send back with a note teach it what to avoid. Revisions you apply teach it what you keep asking for."
            index={1}
            link={{ href: '/product/launch-intelligence', label: 'How it learns' }}
            title="Feedback that sticks"
          >
            <ReviewMock />
          </SplitFeature>
        </div>
      </Section>

      <FaqBlock
        items={[
          {
            q: 'Can sales and support see the launch brief?',
            a: 'Yes. Give them the viewer role. They can read every launch brief, plan, and post, and change nothing.',
          },
          {
            q: 'Who approved what, and when?',
            a: 'Every decision is in the audit log with the teammate, the time, and how many posts it covered.',
          },
          {
            q: 'Does it replace our editorial calendar?',
            a: 'For launches, the plan and schedule cover it. A weekly calendar across launches is on the roadmap.',
          },
        ]}
      />

      <Section>
        <SectionIntro
          label="Related"
          lead="Read how approval works,"
          trail="how a product launch is planned, and what Enterprise adds."
        />
        <div className="mt-24">
          <LinkCards paths={['/product/approvals', '/use-cases/product-launches', '/enterprise']} />
        </div>
      </Section>
    </MarketingShell>
  )
}
