import { cn } from '@/lib/utils'
import {
  ArrowLink,
  HeroStage,
  LinkCards,
  MarketingShell,
  PageHero,
  PullQuote,
  RowTable,
  TileGrid,
} from '../blocks'
import { PipelineCanvas } from '../PipelineCanvas'
import { MONO, MUTED, Section, SectionIntro, Window } from '../primitives'

const OBJECTS = [
  {
    name: 'Release',
    holds:
      'The brief: title, why it matters, description, audience, and up to twenty source links.',
    who: 'Creators, API keys, webhooks',
  },
  {
    name: 'ReleaseSpec',
    holds:
      'The cited launch spec. Every AI draft, human edit, or applied revision is a new version.',
    who: 'AI drafts, people edit and approve one version',
  },
  {
    name: 'CampaignPlan',
    holds:
      'Channels, angles, assets with capture hints, and the timeline. Versioned like the spec.',
    who: 'AI drafts, people approve',
  },
  {
    name: 'CampaignPost',
    holds:
      'Copy, channel, the claims it relies on, and the spec and plan versions it was written against.',
    who: 'AI drafts, creators edit, approvers decide',
  },
  {
    name: 'Design',
    holds: 'An editor document with its plan asset, variant label, and critique.',
    who: 'The visuals agent, anyone in the editor',
  },
  {
    name: 'ScheduledPost',
    holds: 'Destination, time, delivery state, and the provider receipt.',
    who: 'Publishers, then the scheduler',
  },
  {
    name: 'AuditLog',
    holds: 'Every decision with its actor, request ID, and outcome.',
    who: 'Append-only. Nobody edits it',
  },
]

/** /product: the platform overview and a map of its parts. */
export function ProductPage() {
  return (
    <MarketingShell>
      <PageHero
        body="Six parts in one workspace. Each works on its own. Together they turn a release into a reviewed, scheduled launch, with a record of every decision along the way."
        eyebrow={{ label: 'Product' }}
        lead="Everything between the merge"
        location="product_hero"
        trail="and the post."
      >
        <HeroStage>
          <Window
            className="w-full"
            meta={<span className={cn(MONO, 'text-[11.5px]')}>launch run · illustrative</span>}
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
          body="Start with the part you need. Release intake brings the work in, launch intelligence thinks it through, the creative engine makes it visible, approvals keep a person in charge, publishing delivers it, and guardrails hold the whole thing to the truth."
          label="The parts"
          lead="Six parts."
          trail="One workspace."
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
          body="Campaigns are database objects, not chat transcripts. Change one hook, regenerate one image, or approve three posts without replaying a conversation. Every generated piece records the versions it came from."
          label="Object model"
          lead="Structured objects."
          trail="Not chat output."
        />
        <div className="mt-24">
          <RowTable
            caption="Campaign objects"
            head={['Object', 'What it holds', 'Who changes it']}
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
          body="The platform was built in a deliberate order. Primitives first, so every capability works without a model. Recipes next, so a failure names its step. The agent last, so it chooses among proven capabilities instead of improvising them."
          label="Build order"
          lead="Built inside out."
          trail="Agents come last."
        >
          <div className="mt-10">
            <ArrowLink href="/principles">Read the principles</ArrowLink>
          </div>
        </SectionIntro>
        <div className="mt-24 space-y-4">
          <PullQuote
            quote="If we reverse this order and start with the agent, we debug hallucinated workflows instead of building a product."
            source="The marketing platform thesis"
          />
          <TileGrid
            items={[
              {
                snippet: 'primitives',
                title: 'Deterministic primitives',
                body: 'The editor, brand kits, product surfaces, and campaign objects work on their own, through the UI and the API.',
              },
              {
                snippet: 'recipes',
                title: 'Named, versioned recipes',
                body: 'Control flow is code. Models fill in text at fixed points with schema-checked output, and every step can be retried.',
              },
              {
                snippet: 'agent',
                title: 'An agent on top',
                body: 'The model decides what to do. The application decides how it is done safely, inside one workspace, without approval rights.',
              },
            ]}
          />
        </div>
      </Section>

      <Section>
        <SectionIntro label="Where to next" lead="See it in use." trail="Or see who it is for." />
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
