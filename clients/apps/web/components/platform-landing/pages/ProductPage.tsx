import { cn } from '@/lib/utils'
import {
  ArrowLink,
  HeroStage,
  LinkCards,
  MarketingShell,
  PageHero,
  RowTable,
  TileGrid,
} from '../blocks'
import { PipelineCanvas } from '../PipelineCanvas'
import { MONO, MUTED, Section, SectionIntro, Window } from '../primitives'
import { LaunchAnatomy } from '../diagrams/LaunchAnatomy'

const OBJECTS = [
  {
    name: 'Release',
    holds:
      'What you send: title, why it matters, description, audience, and up to twenty source links.',
    who: 'Creators, API keys, webhooks',
  },
  {
    name: 'Launch brief',
    holds:
      'The cited launch brief. Every AI draft, teammate edit, or applied revision saves a new version.',
    who: 'The AI drafts. Teammates edit and approve one version',
  },
  {
    name: 'Plan',
    holds:
      'Channels, angles, visuals with capture hints, and the timeline. Versioned like the launch brief.',
    who: 'The AI drafts. Teammates approve',
  },
  {
    name: 'Post',
    holds:
      'Copy, channel, the claims it relies on, and the launch brief and plan versions it was written against.',
    who: 'The AI drafts, creators edit, approvers decide',
  },
  {
    name: 'Visual',
    holds: 'An editor file with its place in the plan, a variant label, and its check results.',
    who: 'The AI, or anyone in the editor',
  },
  {
    name: 'Scheduled post',
    holds: 'Destination, time, delivery state, and the confirmation from the network.',
    who: 'Publishers, then the scheduler',
  },
  {
    name: 'Audit log',
    holds: 'Every decision with its teammate, request ID, and outcome.',
    who: 'Append-only. Nobody edits it',
  },
]

/** /product: the platform overview and a map of its parts. */
export function ProductPage() {
  return (
    <MarketingShell>
      <PageHero
        body="Send Shots a release. You get a cited launch brief, a plan, on-brand visuals, and posts for six channels, ready for your approval. Six parts do the work, and each one also works on its own."
        eyebrow={{ label: 'Product' }}
        lead="Everything between the merge"
        location="product_hero"
        trail="and the post."
      >
        <HeroStage>
          <Window
            className="w-full"
            meta={<span className={cn(MONO, 'text-[11.5px]')}>example launch</span>}
            title="Acme · Recurring invoices"
          >
            <div className="lg:p-3">
              <PipelineCanvas />
            </div>
          </Window>
        </HeroStage>
      </PageHero>

      <Section>
        <SectionIntro
          body="Release intake brings the work in. Launch intelligence writes the launch brief and the drafts. The creative engine makes the visuals, and approvals keep a teammate in charge. Publishing delivers the posts, and guardrails keep the AI to what your sources say."
          label="The parts"
          lead="Start with the part you need"
          trail="and add the rest when you are ready."
        />
        <div className="mt-24">
          <LinkCards
            paths={[
              '/product/release-intake',
              '/product/launch-intelligence',
              '/product/creative-engine',
              '/product/approvals',
              '/product/publishing',
              '/product/guardrails',
            ]}
          />
        </div>
      </Section>

      <Section>
        <SectionIntro
          body="Change one hook, regenerate one image, or approve three posts without starting over. Every generated piece records the versions it came from."
          label="What is saved"
          lead="Every launch is saved as records,"
          trail="so you can change one piece at a time."
        />
        <div className="mt-24 space-y-12">
          <LaunchAnatomy />
          <RowTable
            caption="Launch records"
            head={['Record', 'What it holds', 'Who changes it']}
            monoLabels
            rows={OBJECTS.map((object) => ({
              label: object.name,
              cells: [object.holds, object.who],
            }))}
          />
        </div>
      </Section>

      <Section>
        <SectionIntro
          body="Every feature works without the AI. When a step fails, it tells you which step. The AI then chooses from features that already work."
          label="Build order"
          lead="We built the manual tools first,"
          trail="then step-by-step workflows, then the AI."
        >
          <div className="mt-10">
            <ArrowLink href="/principles">Read the principles</ArrowLink>
          </div>
        </SectionIntro>
        <div className="mt-24 space-y-4">
          <TileGrid
            items={[
              {
                snippet: '1 · manual tools',
                title: 'Manual tools',
                body: 'The editor, brand kits, product pages, and launch records work on their own, in the app and through the API.',
              },
              {
                snippet: '2 · workflows',
                title: 'Step-by-step workflows',
                body: 'Each workflow runs fixed steps. The AI fills in text at set points, the output is checked, and any step can be retried.',
              },
              {
                snippet: '3 · the AI',
                title: 'The AI on top',
                body: 'The AI picks what to do. Shots decides how it runs safely: inside one workspace, with no approval rights.',
              },
            ]}
          />
        </div>
      </Section>

      <Section>
        <SectionIntro
          label="Where to next"
          lead="See Shots on a real launch,"
          trail="or read the page for your team."
        />
        <div className="mt-24 space-y-4">
          <LinkCards
            paths={[
              '/use-cases/feature-launches',
              '/use-cases/product-launches',
              '/use-cases/changelog-and-email',
            ]}
          />
          <LinkCards
            paths={[
              '/solutions/founders',
              '/solutions/product-marketing',
              '/solutions/developer-tools',
            ]}
          />
        </div>
        <p className={cn('mt-8 text-[15px]', MUTED)}>
          Launch intelligence is in early access for design partners.
        </p>
      </Section>
    </MarketingShell>
  )
}
