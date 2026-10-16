import { ASSET_FORMATS } from '@/lib/launch/spec-schema'
import { cn } from '@/lib/utils'
import { FaqBlock, HeroStage, LinkCards, MarketingShell, PageHero, TileGrid } from '../blocks'
import { PostCard } from '../mocks'
import { MONO, MUTED, Section, SectionIntro } from '../primitives'
import { IntakeMock, SpecMock } from '../WorkflowSection'

const STEPS = [
  {
    title: 'The release arrives',
    body: 'A GitHub release fires your webhook, or someone fills in the release form with the pull request and changelog links.',
  },
  {
    title: 'The spec drafts itself',
    body: 'Problem, audience, what changed, capabilities, proof, and limitations, each claim citing the pull request, the changelog, or the brief.',
  },
  {
    title: 'You answer what it could not',
    body: 'Gaps show up as open questions instead of invented claims. Your answers join the trusted brief.',
  },
  {
    title: 'You approve a plan',
    body: 'Channels, angles, and the assets to capture, split into teaser, launch day, and follow-up.',
  },
  {
    title: 'Visuals and copy arrive together',
    body: 'Real screenshots framed on brand, and posts for every channel that cite their claims and fit their limits.',
  },
  {
    title: 'Approve all, then schedule',
    body: 'Approve every post in one click, or fix the one that is off. A publisher schedules the approved posts.',
  },
]

/** /use-cases/feature-launches: announcing a shipped feature the day it ships. */
export function FeatureLaunchesPage() {
  return (
    <MarketingShell finale={{ lead: 'Ship it Tuesday.', trail: 'Announce it Tuesday.' }}>
      <PageHero
        body="A feature is not launched until people hear about it. Send the release from GitHub or describe it in a sentence, and get a cited brief, real screenshots, and posts for every channel the same day."
        eyebrow={{ href: '/use-cases', label: 'Feature launches', parent: 'Use cases' }}
        lead="Ship the feature."
        location="feature_launches_hero"
        trail="Say so the same day."
      >
        <HeroStage>
          <div className="grid w-full max-w-[960px] gap-4 md:grid-cols-2">
            <PostCard
              body="Stop rebuilding the same invoice every month. Recurring invoices are live in Acme: set the schedule once and every cycle sends itself."
              channel="x"
              claims={['capabilities.0', 'whatChanged.1']}
              image
            />
            <div className="grid gap-4">
              <PostCard
                body="The third invoice of the month is the one that gets forgotten. Recurring invoices fix that. Pick monthly, quarterly, or yearly, and pause any time."
                channel="linkedin"
                claims={['problem.0', 'capabilities.1']}
              />
              <PostCard
                body="Set a schedule once and Acme sends the invoice every cycle."
                channel="product_hunt"
                claims={['summary']}
                title="Acme recurring invoices"
              />
            </div>
          </div>
        </HeroStage>
      </PageHero>

      <Section>
        <SectionIntro
          body="Six steps from merge to scheduled posts. Two of them are decisions only you can make."
          label="Walkthrough"
          lead="From merge"
          trail="to scheduled posts."
        />
        <ol className="mt-24 grid gap-px overflow-hidden border border-[#212121] bg-[#212121] md:grid-cols-2 lg:grid-cols-3">
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
        <div className="mt-16 grid gap-4 md:grid-cols-2">
          <IntakeMock />
          <SpecMock />
        </div>
      </Section>

      <Section>
        <SectionIntro
          body="Everything a feature announcement needs, built to the same spec, so the X post and the changelog never disagree."
          label="What you get"
          lead="One release."
          trail="The whole kit."
        />
        <div className="mt-24">
          <TileGrid
            items={[
              {
                snippet: 'spec · cited',
                title: 'A launch brief',
                body: 'The cited spec doubles as the internal brief for support and sales.',
              },
              {
                snippet: ASSET_FORMATS.join(' · '),
                title: 'Assets in every format',
                body: 'A hero, a feature shot, a social card, and a story, from your real product.',
              },
              {
                snippet: 'X · LinkedIn · Instagram',
                title: 'Social posts',
                body: 'Several angles per channel, each within the channel limit and in your voice.',
              },
              {
                snippet: 'Product Hunt',
                title: 'A launch listing',
                body: 'A tagline and description that fit Product Hunt, ready to paste.',
              },
              {
                snippet: 'changelog',
                title: 'A changelog entry',
                body: 'What changed, why it matters, and what it does not do yet.',
              },
              {
                snippet: 'email',
                title: 'A release email',
                body: 'A subject and body for subscribers who asked to hear about releases.',
              },
            ]}
          />
        </div>
      </Section>

      <FaqBlock
        items={[
          {
            q: 'What if nobody wrote release notes?',
            a: 'Link the pull request. The spec reads its title, description, and the release page, and asks you about anything it cannot support.',
          },
          {
            q: 'Can I launch a small fix too?',
            a: 'Yes, and you should keep it small. Pick fewer channels in the plan, or approve only the changelog entry.',
          },
          {
            q: 'What if the screenshot shows the wrong screen?',
            a: 'Each asset in the plan names the page to capture. Edit the plan, or revise that one design, and leave the rest alone.',
          },
        ]}
      />

      <Section>
        <SectionIntro label="Related" lead="Keep reading." trail="Every part connects." />
        <div className="mt-24">
          <LinkCards
            paths={[
              '/product/launch-intelligence',
              '/use-cases/product-launches',
              '/product/release-intake',
            ]}
          />
        </div>
      </Section>
    </MarketingShell>
  )
}
