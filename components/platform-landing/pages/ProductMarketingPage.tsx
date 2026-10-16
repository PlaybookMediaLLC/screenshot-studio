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

/** /solutions/product-marketing: a cited source of truth, approvals, and an audit trail. */
export function ProductMarketingPage() {
  return (
    <MarketingShell finale={{ lead: 'One source of truth.', trail: 'Every launch.' }}>
      <PageHero
        body="Engineering ships, and you find out from the changelog. Screenshot Studio turns each release into a cited brief your whole team can trust, a plan you approve, and assets and copy built to both."
        eyebrow={{ href: '/use-cases', label: 'Product marketing', parent: 'Solutions' }}
        lead="From brief to launch kit"
        location="product_marketing_hero"
        trail="without the scramble."
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
          body="Every claim in the spec cites the pull request, the changelog, or the brief. Gaps are questions for you, not guesses. Approve one version and every asset is built to it."
          label="Source of truth"
          lead="A brief that cites"
          trail="what engineering shipped."
        />
        <div className="mt-24">
          <TileGrid
            items={[
              {
                snippet: 'messaging · pillars',
                title: 'Positioning, written down',
                body: 'Messaging pillars, positioning against alternatives, and calls to action live in the spec, not in someone’s head.',
              },
              {
                snippet: 'v3 approved · v4 draft',
                title: 'Versions, not overwrites',
                body: 'Every AI draft, human edit, and applied revision is a new version. You always know which one the posts were written to.',
              },
              {
                snippet: 'beforeAfter · limitations',
                title: 'Honest by structure',
                body: 'Limitations are a section of the spec, so the launch never promises what the release does not do.',
              },
            ]}
          />
        </div>
      </Section>

      <Section>
        <SectionIntro
          body="Separate the people who write from the people who sign off and the people who press go. Each role sees everything and can do only its part."
          label="Team"
          lead="The right person"
          trail="at each step."
        />
        <div className="mt-24">
          <RowTable
            caption="Launch team roles"
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
          body="Brand stays consistent because nobody chooses it per asset. Feedback compounds because every note you leave teaches the next run."
          label="Quality"
          lead="On brand by default."
          trail="Better every launch."
        />
        <div className="mt-24 space-y-24">
          <SplitFeature
            body="The brand kit is applied to every design the agents make: the gradient, the accent, the text color, and the nearest font."
            index={0}
            link={{ href: '/product/creative-engine', label: 'See the creative engine' }}
            title="Brand applied, not requested"
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
            q: 'Can sales and support see the brief?',
            a: 'Yes. Give them the viewer role. They can read every spec, plan, and post and change nothing.',
          },
          {
            q: 'Who approved what, and when?',
            a: 'Every decision is in the audit log with the person, the time, and how many posts it covered.',
          },
          {
            q: 'Does it replace our editorial calendar?',
            a: 'For launches, the plan and schedule cover it. A cross-campaign weekly calendar is on the roadmap.',
          },
        ]}
      />

      <Section>
        <SectionIntro label="Related" lead="Keep reading." trail="Every part connects." />
        <div className="mt-24">
          <LinkCards paths={['/product/approvals', '/use-cases/product-launches', '/enterprise']} />
        </div>
      </Section>
    </MarketingShell>
  )
}
