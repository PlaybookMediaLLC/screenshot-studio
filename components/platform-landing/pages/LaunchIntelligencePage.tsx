import { CpuIcon, Database01Icon, FileValidationIcon, Shield01Icon } from 'hugeicons-react'
import { LAUNCH_AI_RATE_LIMIT } from '@/lib/api/rate-limit-policy'
import { CHANNEL_RULES, HYPE_TERMS } from '@/lib/launch/guards'
import { formatTeamPreferences } from '@/lib/launch/preferences-format'
import {
  ASSET_FORMATS,
  ASSET_KINDS,
  LAUNCH_CHANNEL_LABELS,
  LAUNCH_CHANNELS,
  PLAN_PHASE_LABELS,
  PLAN_PHASES,
  REVISION_TARGETS,
  SPEC_SECTION_LABELS,
  SPEC_SECTIONS,
  type SpecSectionKey,
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
import { MONO, MUTED, Section, SectionIntro, Tag, Window } from '../primitives'
import { CopyMock, PlanMock, ReviewMock, SpecMock, VisualsMock } from '../WorkflowSection'

/** What each spec section holds. Keyed by the schema, so a new section fails the build here. */
const SECTION_NOTES: Record<SpecSectionKey, string> = {
  summary: 'A one-paragraph overview of the release.',
  problem: 'The pain it removes, as cited claims.',
  audience: 'The segments it serves and what each needs.',
  whatChanged: 'What actually shipped.',
  capabilities: 'Named capabilities with descriptions.',
  beforeAfter: 'Before and after pairs a reader can picture.',
  proofPoints: 'Evidence, limited to what the sources state.',
  limitations: 'What it does not do yet.',
  faqs: 'Questions and answers for the launch.',
  messaging: 'Pillars, positioning against alternatives, and calls to action.',
  openQuestions: 'Gaps the model would otherwise have to invent. You answer them.',
}

const ASSET_LABELS: Record<(typeof ASSET_KINDS)[number], string> = {
  hero: 'Hero',
  feature_shot: 'Feature shot',
  social_card: 'Social card',
  story: 'Story',
}

const REVISION_LABELS: Record<(typeof REVISION_TARGETS)[number], string> = {
  spec_section: 'A spec section',
  post: 'A post',
  design: 'A design',
  plan: 'The plan',
}

/** A real team_preferences block, produced by the same formatter generation uses. */
const PREFERENCES_EXAMPLE = formatTeamPreferences({
  approved: [
    {
      channel: 'x',
      copy: 'Stop rebuilding the same invoice every month. Recurring invoices are live in Acme.',
      title: null,
    },
  ],
  rejected: [
    {
      channel: 'linkedin',
      copy: 'We are thrilled to announce a game-changing update to invoicing!',
      note: 'Too much hype. Lead with the problem.',
      status: 'NEEDS_CHANGES',
    },
  ],
  revisions: [
    {
      after: 'Set the schedule once.',
      before: 'Configure recurrence rules.',
      comment: 'Plain words, no settings jargon.',
      targetType: 'post',
    },
  ],
})

const limit = (value: number) => (value > 0 ? value.toLocaleString('en-US') : 'none')

/** /product/launch-intelligence: sources, spec, plan, production, review, learning, and limits. */
export function LaunchIntelligencePage() {
  return (
    <MarketingShell finale={{ lead: 'Ship the feature.', trail: 'Get the launch, cited.' }}>
      <PageHero
        body="Launch intelligence reads what you shipped, drafts a launch spec where every claim has a source, plans the campaign, and produces visuals and copy for every channel. You approve each stage, and it learns from what you keep."
        eyebrow={{ href: '/product', label: 'Launch intelligence', parent: 'Product' }}
        lead="A launch team"
        location="launch_intelligence_hero"
        secondary={{ href: '/design-partners', label: 'Become a design partner' }}
        trail="that cites its sources."
      >
        <HeroStage>
          <div className="grid w-full max-w-[880px] gap-4 md:grid-cols-2">
            <SpecMock />
            <CopyMock />
          </div>
        </HeroStage>
      </PageHero>

      <Section>
        <SectionIntro
          body="Everything the release says about itself, and nothing it does not. Sources are evidence for the model, never instructions to it."
          label="Sources"
          lead="It reads the release"
          trail="and everything it links to."
        />
        <div className="mt-24">
          <TileGrid
            items={[
              {
                snippet: 'brief · trusted',
                title: 'The brief',
                body: 'Title, why it matters, description, audience, and the open questions you have answered. Typed by your team, so it is trusted.',
              },
              {
                snippet: 'S1 … S8',
                title: 'Numbered sources',
                body: 'Each source link and the product URL, fetched safely. Pull requests and GitHub releases are read through the GitHub API, everything else as HTML or text.',
              },
              {
                snippet: 'trust="untrusted"',
                title: 'Machine briefs are fenced',
                body: 'A release from a webhook or an API key has no author on your team. Its brief is fenced like a source, checked for prompt injection, and shown with the sources for review.',
              },
            ]}
          />
        </div>
      </Section>

      <Section>
        <SectionIntro
          body="The spec is the single source of truth for the launch. A claim that cites nothing, or cites a source that does not exist, is removed and becomes an open question. Every draft, edit, and applied revision is a new version, and one version is approved."
          label="The spec"
          lead={`${SPEC_SECTIONS.length} sections.`}
          trail="Every claim cited."
        />
        <div className="mt-24">
          <RowTable
            caption="Launch spec sections"
            head={['Section', 'What it holds']}
            rows={SPEC_SECTIONS.map((section) => ({
              label: SPEC_SECTION_LABELS[section],
              cells: [SECTION_NOTES[section]],
            }))}
          />
        </div>
      </Section>

      <Section>
        <SectionIntro
          body="Approve the plan the way you would approve a pull request. Then everything downstream is built to it, and anything built to an older plan is marked."
          label="The plan"
          lead="A plan first."
          trail="Posts second."
        />
        <div className="mt-24">
          <SplitFeature
            body="Each channel gets a role and a cadence. Each angle maps to a messaging pillar. Each asset names the capability it shows, the page to capture, the device, and what to focus on."
            index={0}
            title="Channels, angles, assets, and a timeline"
          >
            <PlanMock />
          </SplitFeature>
        </div>
        <div className="mt-16 grid gap-4 md:grid-cols-3">
          <div className="bg-[#111] p-8">
            <p className={cn('text-[15px]', MUTED)}>Channels</p>
            <div className="mt-5 flex flex-wrap gap-2">
              {LAUNCH_CHANNELS.map((channel) => (
                <Tag key={channel}>{LAUNCH_CHANNEL_LABELS[channel]}</Tag>
              ))}
            </div>
          </div>
          <div className="bg-[#111] p-8">
            <p className={cn('text-[15px]', MUTED)}>Assets and formats</p>
            <div className="mt-5 flex flex-wrap gap-2">
              {ASSET_KINDS.map((kind) => (
                <Tag key={kind}>{ASSET_LABELS[kind]}</Tag>
              ))}
              {ASSET_FORMATS.map((format) => (
                <Tag key={format}>{format}</Tag>
              ))}
            </div>
          </div>
          <div className="bg-[#111] p-8">
            <p className={cn('text-[15px]', MUTED)}>Timeline</p>
            <ol className="mt-5 flex flex-wrap items-center gap-2">
              {PLAN_PHASES.map((phase, index) => (
                <li className="flex items-center gap-2" key={phase}>
                  {index > 0 ? <span className="text-white/30">→</span> : null}
                  <Tag invert={phase === 'launch'}>{PLAN_PHASE_LABELS[phase]}</Tag>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </Section>

      <Section>
        <SectionIntro
          body="A visuals agent and a copy agent run side by side against the approved spec and plan. Neither moves on until its work passes the checks."
          label="Produce"
          lead="Two agents."
          trail="One spec, one brand."
        />
        <div className="mt-24 space-y-24">
          <SplitFeature
            body="The visuals agent captures your product, composes it in the editor, and applies the workspace brand kit: a gradient from the brand background to the accent, the brand text color, and the nearest font in the catalog."
            bullets={[
              'Designs carry their plan asset and an A or B variant label',
              'Every render is critiqued against the spec, the brand kit, and legibility',
              'A failing render is fixed and rendered again before the agent moves on',
              'The critique is stored with the design and shown on the asset board',
            ]}
            index={1}
            link={{ href: '/product/creative-engine', label: 'See the creative engine' }}
            title="Visuals from your real product"
          >
            <VisualsMock />
          </SplitFeature>
          <SplitFeature
            body="The copy agent writes channel-native posts in your brand voice, several angles per channel, and lists the spec claims each post relies on."
            bullets={[
              'Over-limit posts are rejected with the measured overflow',
              'Hype words and your prohibited terms are rejected',
              'Links must point at the product or a release source',
              'Email addresses and uncited claims are rejected',
            ]}
            index={2}
            title="Copy that cites its claims"
          >
            <CopyMock />
          </SplitFeature>
        </div>
      </Section>

      <Section>
        <SectionIntro
          body="Copy is checked against these rules before it is saved. The model gets the reasons back and fixes the post in the same run. Anything still failing is never stored."
          label="Channel rules"
          lead="Limits, checked."
          trail="Not suggested."
        />
        <div className="mt-24 grid gap-16 lg:grid-cols-[1.4fr_1fr]">
          <RowTable
            caption="Channel copy limits"
            head={['Channel', 'Title', 'Body with call to action', 'Hashtags']}
            rows={LAUNCH_CHANNELS.map((channel) => {
              const rule = CHANNEL_RULES[channel]
              return {
                label: LAUNCH_CHANNEL_LABELS[channel],
                cells: [
                  rule.title.required ? `${limit(rule.title.max)} chars` : 'none',
                  `${limit(rule.bodyMax)} chars`,
                  limit(rule.hashtagMax),
                ].map((value) => (
                  <span className={cn(MONO, 'text-[13px]')} key={value}>
                    {value}
                  </span>
                )),
              }
            })}
          />
          <div>
            <p className="text-lg text-white">Words it will not write</p>
            <p className={cn('mt-2 text-[15px]', MUTED)}>
              Plus every term on your brand profile&apos;s prohibited list.
            </p>
            <ul className="mt-6 flex flex-wrap gap-2">
              {HYPE_TERMS.map((term) => (
                <li
                  className={cn(
                    MONO,
                    'rounded-md bg-white/[0.05] px-2 py-1 text-[12px] text-white/50 line-through decoration-white/30'
                  )}
                  key={term}
                >
                  {term}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      <Section>
        <SectionIntro
          body="Reviewers approve, reject with a note, or request changes. Revise with AI works on any piece and returns a proposal, never an edit."
          label="Review"
          lead="Proposals, not edits."
          trail="You apply what you want."
        />
        <div className="mt-24">
          <SplitFeature
            body="A revision proposal shows a word diff for its target, plus consistency updates for anything that depends on it, such as the posts that cite a messaging pillar you just changed. Choose which updates to include. Nothing changes until you apply."
            bullets={REVISION_TARGETS.map((target) => `${REVISION_LABELS[target]} can be revised`)}
            index={3}
            link={{ href: '/product/approvals', label: 'How approval works' }}
            title="Revise with AI, decide by hand"
          >
            <ReviewMock />
          </SplitFeature>
        </div>
      </Section>

      <Section>
        <SectionIntro
          body="Every plan, copy, and revision run starts from your own history: posts you approved, posts you sent back with a note, and the changes you asked for. Retrieval is deterministic and scoped to your workspace. No model is trained on it."
          label="Learning"
          lead="It learns your taste"
          trail="from your team, not the internet."
        />
        <div className="mt-24">
          <Window meta="generated by formatTeamPreferences()" title="team_preferences">
            <pre
              className={cn(
                MONO,
                'overflow-x-auto whitespace-pre-wrap p-5 text-[12.5px] leading-[1.7] text-white/75'
              )}
            >
              {PREFERENCES_EXAMPLE}
            </pre>
          </Window>
        </div>
      </Section>

      <Section>
        <SectionIntro
          body="Bounded, attributable, and testable. Every action has a cost you can see and a record you can audit."
          label="Under the hood"
          lead="Models, meters,"
          trail="and an audit trail."
        />
        <div className="mt-24">
          <TileGrid
            columns={2}
            items={[
              {
                icon: CpuIcon,
                title: 'Models by role',
                body: 'Claude Opus 5.5 for deep reasoning, Claude Sonnet 5.5 for drafting, and Claude Haiku 4.5 for fast work, routed through OpenRouter. Each role is configurable.',
              },
              {
                icon: Database01Icon,
                title: 'Metered per workspace',
                body: `Each model call is charged AI credits for what it costs, and AI actions are limited to ${LAUNCH_AI_RATE_LIMIT.maxRequests} a minute per workspace, so a burst of clicks cannot spend the month.`,
              },
              {
                icon: Shield01Icon,
                title: 'Audited',
                body: 'Spec, plan, production, and revision actions write audit events with the model ID and token usage. Prompts and completions are not written to the audit log.',
              },
              {
                icon: FileValidationIcon,
                title: 'Tested without a model',
                body: 'A deterministic scripted model runs the whole pipeline in end-to-end tests. Production builds refuse it.',
              },
            ]}
          />
        </div>
      </Section>

      <FaqBlock
        items={[
          {
            q: 'What does it need from me?',
            a: 'A release title and either a sentence on why it matters or at least one source link. More sources make a better spec: the pull request, the changelog entry, and the docs page.',
          },
          {
            q: 'What happens when it does not know something?',
            a: 'It asks. Gaps become open questions on the spec instead of invented claims, and your answers become part of the trusted brief.',
          },
          {
            q: 'Can I edit the spec and plan myself?',
            a: 'Yes. Every human edit creates a new version. Approve the version you want the campaign built from.',
          },
          {
            q: 'Does it publish anything?',
            a: 'No. Launch intelligence drafts. Posts go to review, and only approved posts can be scheduled.',
          },
          {
            q: 'How do I get access?',
            a: 'Launch intelligence is in early access for design partners. Apply on the design partners page and we will enable it on your workspace.',
          },
        ]}
      />

      <Section>
        <SectionIntro label="Related" lead="Keep reading." trail="Every part connects." />
        <div className="mt-24">
          <LinkCards
            paths={['/product/guardrails', '/product/approvals', '/use-cases/feature-launches']}
          />
        </div>
      </Section>
    </MarketingShell>
  )
}
