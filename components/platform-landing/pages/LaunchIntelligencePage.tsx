import { PiCpu as CpuIcon, PiDatabase as Database01Icon, PiSealCheck as FileValidationIcon, PiShield as Shield01Icon } from 'react-icons/pi'
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
import { CitationTrail } from '../diagrams/CitationTrail'

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
  openQuestions: 'Gaps no source covers. You answer them.',
}

const ASSET_LABELS: Record<(typeof ASSET_KINDS)[number], string> = {
  hero: 'Hero',
  feature_shot: 'Feature shot',
  social_card: 'Social card',
  story: 'Story',
}

const REVISION_LABELS: Record<(typeof REVISION_TARGETS)[number], string> = {
  spec_section: 'A launch brief section',
  post: 'A post',
  design: 'A visual',
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
    <MarketingShell
      finale={{ lead: 'Apply for early access', trail: 'and run your next release through it.' }}
    >
      <PageHero
        body="Launch intelligence reads what you shipped and writes a launch brief where every claim has a source. Then it plans the launch and drafts visuals and posts for every channel. You approve each stage, and the AI learns from what you keep."
        eyebrow={{ href: '/product', label: 'Launch intelligence', parent: 'Product' }}
        lead="Launch posts drafted from your release,"
        location="launch_intelligence_hero"
        secondary={{ href: '/design-partners', label: 'Become a design partner' }}
        trail="with a source for every claim."
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
          body="The AI works only from what your release and its links say. Text in a source that reads like instructions is flagged for you."
          label="Sources"
          lead="It reads the release"
          trail="and everything it links to."
        />
        <div className="mt-24">
          <TileGrid
            items={[
              {
                snippet: 'brief · trusted',
                title: 'Your release',
                body: 'Title, why it matters, description, audience, and the open questions you answered. Your team typed it, so the AI trusts it.',
              },
              {
                snippet: 'S1 … S8',
                title: 'Numbered sources',
                body: 'Each source link and the product URL, fetched from public addresses only. Pull requests and GitHub releases are read through the GitHub API. Everything else is read as HTML or text.',
              },
              {
                snippet: 'trust="untrusted"',
                title: 'Automated releases are checked',
                body: 'A release from a webhook or an API key has no author on your team. The AI treats its text like any other source, checks it for hidden instructions, and shows it to you for review.',
              },
            ]}
          />
        </div>
      </Section>

      <Section>
        <SectionIntro
          body="Every post is written from the launch brief. A claim that cites nothing, or cites a missing source, is removed and becomes an open question. Every draft, edit, and applied revision saves a new version, and you approve one."
          label="The launch brief"
          lead={`${SPEC_SECTIONS.length} sections in every launch brief,`}
          trail="and each claim cites a source."
        />
        <div className="mt-24 space-y-12">
          <CitationTrail />
          <RowTable
            caption="Launch brief sections"
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
          body="Review the plan the way you would review a pull request. Everything after it is built to the approved plan, and anything built to an older plan is marked."
          label="The plan"
          lead="You approve the plan"
          trail="before any post is written."
        />
        <div className="mt-24">
          <SplitFeature
            body="Each channel gets a role and a cadence, and each angle maps to a messaging pillar. Each visual names the capability it shows, the page to capture, the device, and the focus."
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
            <p className={cn('text-[15px]', MUTED)}>Visuals and formats</p>
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
          body="The AI makes the visuals and writes the posts at the same time. Neither moves on until its work passes the checks."
          label="Produce"
          lead="Visuals and posts are made side by side"
          trail="from the approved launch brief and plan."
        />
        <div className="mt-24 space-y-24">
          <SplitFeature
            body="The AI captures your product, lays it out in the editor, and applies your brand kit: a gradient from the brand background to the accent, the brand text color, and the nearest font in the catalog."
            bullets={[
              'Visuals carry their place in the plan and an A or B variant label',
              'Every visual is checked against the launch brief, the brand kit, and legibility',
              'A visual that fails is fixed and rendered again before the AI moves on',
              'The check results are saved with the visual and shown on the asset board',
            ]}
            index={1}
            link={{ href: '/product/creative-engine', label: 'See the creative engine' }}
            title="Visuals from your real product"
          >
            <VisualsMock />
          </SplitFeature>
          <SplitFeature
            body="The AI writes posts for each channel in your brand voice, with several angles per channel. Each post lists the claims from the launch brief it relies on."
            bullets={[
              'Over-limit posts fail with the measured overflow',
              'Hype words and your banned terms fail',
              'Links must point at the product or a release source',
              'Email addresses and uncited claims fail',
            ]}
            index={2}
            title="Posts that cite their claims"
          >
            <CopyMock />
          </SplitFeature>
        </div>
      </Section>

      <Section>
        <SectionIntro
          body="Copy checks run before a post is saved. The AI gets the reasons back and fixes the post in the same launch. A post that still fails is discarded."
          label="Channel rules"
          lead="Every post is checked against its channel's limits"
          trail="before it is saved."
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
              Plus every term on your brand profile&apos;s banned list.
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
          body="Reviewers approve, reject with a note, or request changes. Revise with AI works on any piece and returns a proposal for you to review."
          label="Review"
          lead="AI revisions arrive as proposals"
          trail="that you apply or discard."
        />
        <div className="mt-24">
          <SplitFeature
            body="A proposal shows a word diff for its target. It also suggests matching updates for anything that depends on it, such as posts that cite a messaging pillar you changed. Choose which updates to include. Nothing changes until you apply."
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
          body="Each plan, post, and revision starts from your history: posts you approved, posts you sent back with a note, and changes you asked for. Shots looks this up within your workspace only, the same way every time. No model is trained on it."
          label="Learning"
          lead="It learns your taste"
          trail="from your team's own history."
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
          body="Every AI action has a cost you can see and a record you can audit."
          label="Under the hood"
          lead="Which models run,"
          trail="what they cost, and what gets logged."
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
                body: `Each AI call is charged credits at cost. AI actions are limited to ${LAUNCH_AI_RATE_LIMIT.maxRequests} a minute per workspace, so a burst of clicks can't spend the month.`,
              },
              {
                icon: Shield01Icon,
                title: 'Audited',
                body: 'Launch brief, plan, drafting, and revision actions write audit events with the model ID and token usage. Prompts and completions stay out of the audit log.',
              },
              {
                icon: FileValidationIcon,
                title: 'Tested without a model',
                body: 'End-to-end tests run the whole launch with a scripted stand-in model. Production builds refuse it.',
              },
            ]}
          />
        </div>
      </Section>

      <FaqBlock
        items={[
          {
            q: 'What does it need from me?',
            a: 'A release title and either a sentence on why it matters or at least one source link. More sources make a better launch brief: the pull request, the changelog entry, and the docs page.',
          },
          {
            q: 'What happens when it does not know something?',
            a: 'It asks. Gaps become open questions on the launch brief, and your answers become part of the release.',
          },
          {
            q: 'Can I edit the launch brief and plan myself?',
            a: 'Yes. Every edit saves a new version. Approve the version you want the launch built from.',
          },
          {
            q: 'Does it publish anything?',
            a: 'No. The AI only drafts. Posts go to review, and only approved posts can be scheduled.',
          },
          {
            q: 'How do I get access?',
            a: 'It is in early access for design partners. Apply on the design partners page and we will turn it on for your workspace.',
          },
        ]}
      />

      <Section>
        <SectionIntro
          label="Related"
          lead="Read how the AI is kept honest,"
          trail="how approval works, and a feature launch end to end."
        />
        <div className="mt-24">
          <LinkCards
            paths={['/product/guardrails', '/product/approvals', '/use-cases/feature-launches']}
          />
        </div>
      </Section>
    </MarketingShell>
  )
}
