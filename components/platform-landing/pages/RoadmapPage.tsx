import { cn } from '@/lib/utils'
import { MarketingShell, PageHero, PullQuote } from '../blocks'
import { GITHUB_URL } from '../LandingNav'
import { MONO, MUTED, Section, SectionIntro } from '../primitives'

const DOC = (file: string) => `${GITHUB_URL}/blob/main/docs/${file}`

type Item = { title: string; body: string; ref: string; href: string }

const COLUMNS: { name: string; tone: string; note: string; items: Item[] }[] = [
  {
    name: 'Shipped',
    tone: 'text-emerald-400',
    note: 'In the product today',
    items: [
      {
        title: 'Launch intelligence',
        body: 'Cited spec, plan, visuals and copy, review and revise. Early access.',
        ref: 'Docs',
        href: DOC('launch-intelligence.md'),
      },
      {
        title: 'Approval workflow',
        body: 'Server-side states, batch approval, six roles.',
        ref: 'RFC 019',
        href: DOC('rfcs/019-approval-workflow.md'),
      },
      {
        title: 'Publishing abstraction',
        body: 'Durable scheduling with receipts behind one provider seam.',
        ref: 'RFC 020',
        href: DOC('rfcs/020-postiz-publishing.md'),
      },
      {
        title: 'Campaign objects',
        body: 'Campaigns, angles, and posts as database objects.',
        ref: 'RFC 014',
        href: DOC('rfcs/014-structured-marketing-objects.md'),
      },
      {
        title: 'Brand and product surfaces',
        body: 'Brand profile and kits, and the map from features to screens.',
        ref: 'RFC 011, 013',
        href: DOC('rfcs/011-brand-profile.md'),
      },
      {
        title: 'Tenancy, auth, and enterprise',
        body: 'Organizations, roles, SSO, SCIM, audit logs, and SIEM drains.',
        ref: 'RFC 002, 003',
        href: DOC('rfcs/003-better-auth-enterprise-audit.md'),
      },
      {
        title: 'Release intake',
        body: 'Signed webhooks and the release and asset pipeline.',
        ref: 'RFC 005, 006',
        href: DOC('rfcs/005-repository-webhook-scheduler-integrations.md'),
      },
    ],
  },
  {
    name: 'Now',
    tone: 'text-white',
    note: 'Being built',
    items: [
      {
        title: 'REST API and reference',
        body: 'A first-class REST API with an interactive Scalar reference.',
        ref: 'RFC 034',
        href: DOC('rfcs/034-rest-api-scalar-reference.md'),
      },
    ],
  },
  {
    name: 'Next',
    tone: 'text-white',
    note: 'Up after that',
    items: [
      {
        title: 'Programmable creative engine',
        body: 'The editor as domain services, so the UI, the API, and the agent render the same way.',
        ref: 'RFC 010',
        href: DOC('rfcs/010-programmable-creative-engine.md'),
      },
      {
        title: 'Paste a URL, get a profile',
        body: 'Product intelligence and a background onboarding agent with ideal customer profiles.',
        ref: 'RFC 012, 032',
        href: DOC('rfcs/032-background-onboarding-agent.md'),
      },
      {
        title: 'The launch recipe',
        body: 'A deterministic, resumable feature-launch pipeline.',
        ref: 'RFC 015',
        href: DOC('rfcs/015-feature-launch-recipe.md'),
      },
      {
        title: 'Typed marketing tools',
        body: 'About ten domain tools for an agent with no infrastructure access.',
        ref: 'RFC 016',
        href: DOC('rfcs/016-ai-sdk-marketing-tools.md'),
      },
      {
        title: 'Conversation and workspace',
        body: 'One sentence to a draft campaign, in a workspace that works without chat.',
        ref: 'RFC 017, 018',
        href: DOC('rfcs/018-campaign-workspace.md'),
      },
      {
        title: 'Three core workflows',
        body: 'Launch something, ship a feature, stay visible, and seven posts at onboarding.',
        ref: 'RFC 021',
        href: DOC('rfcs/021-core-workflows.md'),
      },
    ],
  },
  {
    name: 'Later',
    tone: 'text-[#858585]',
    note: 'Designed, not scheduled',
    items: [
      {
        title: 'Changes become launches',
        body: 'Merged pull requests suggest campaigns. Deploys capture fresh screens.',
        ref: 'RFC 022, 023',
        href: DOC('rfcs/022-github-integration.md'),
      },
      {
        title: 'Demo videos',
        body: 'Captioned demos from captured product flows.',
        ref: 'RFC 024',
        href: DOC('rfcs/024-demo-video-generation.md'),
      },
      {
        title: 'Pillars and the weekly plan',
        body: 'Content pillars and a weekly plan approved in one action.',
        ref: 'RFC 025, 029',
        href: DOC('rfcs/029-recurring-campaign-generation.md'),
      },
      {
        title: 'Research, analytics, feedback',
        body: 'Cited research, post performance, and plans weighted by what worked.',
        ref: 'RFC 026, 027, 028',
        href: DOC('rfcs/028-feedback-driven-generation.md'),
      },
      {
        title: 'Policies and autonomy',
        body: 'Approval policies, then Manual, Copilot, and Autopilot modes.',
        ref: 'RFC 030, 031',
        href: DOC('rfcs/031-autonomy-modes.md'),
      },
    ],
  },
]

const GENERATIONS = [
  ['V1', 'Screenshot Studio plus AI creative generation'],
  ['V2', 'URL to campaign'],
  ['V3', 'Product changes to campaigns, automatically'],
  ['V4', 'Campaign, publish, performance, next campaign'],
  ['V5', 'Marketing intelligence across GitHub, website, and analytics'],
] as const

/** /roadmap: shipped, now, next, and later, each linked to its RFC. */
export function RoadmapPage() {
  return (
    <MarketingShell finale={{ lead: 'Help decide', trail: 'what ships next.' }}>
      <PageHero
        body="The plan is written down and public. Primitives first, then recipes, then the agent. Autonomy comes last, and only as far as your approval policies allow. Every item links to the document behind it."
        eyebrow={{ label: 'Roadmap' }}
        lead="Today you bring the release."
        location="roadmap_hero"
        primary={{ href: '/design-partners', label: 'Become a design partner' }}
        secondary={{ href: '/changelog', label: 'Read the changelog' }}
        trail="Next, your product brings it."
      />

      <Section>
        <div className="grid gap-px overflow-hidden border border-[#212121] bg-[#212121] md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((column) => (
            <div className="bg-[#090909] p-6" key={column.name}>
              <p className={cn(MONO, 'text-[12px] uppercase tracking-[0.08em]', column.tone)}>
                {column.name}
              </p>
              <p className={cn('mt-1 text-[13px]', MUTED)}>{column.note}</p>
              <ul className="mt-8 space-y-3">
                {column.items.map((item) => (
                  <li key={item.title}>
                    <a
                      className="group block bg-[#111] p-4 transition-colors hover:bg-[#161616]"
                      href={item.href}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="text-[15px] text-white">{item.title}</span>
                        <span className={cn(MONO, 'shrink-0 text-[10.5px]', MUTED)}>
                          {item.ref}
                        </span>
                      </span>
                      <span className={cn('mt-1.5 block text-[13.5px] leading-[1.5]', MUTED)}>
                        {item.body}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      <Section>
        <SectionIntro
          body="The product grows in generations. Each one expands the same object model instead of starting over."
          label="Generations"
          lead="Five generations."
          trail="One object model."
        />
        <ol className="mt-24 grid gap-4 md:grid-cols-5">
          {GENERATIONS.map(([version, title]) => (
            <li className="bg-[#111] p-6" key={version}>
              <span className={cn(MONO, 'text-[13px] text-white')}>{version}</span>
              <p className={cn('mt-8 text-[15px] leading-[1.5]', MUTED)}>{title}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section>
        <SectionIntro
          body="Two gaps stand between today and the full launch workflow, and both are written down: billing with usage quotas, and capturing pages behind a login."
          label="Open gaps"
          lead="What we have not solved"
          trail="is on the page too."
        />
        <div className="mt-24">
          <PullQuote
            quote="When a founder can paste a SaaS URL, get seven good posts with real product screenshots, approve them, and schedule them, we have a product founders can pay for."
            source="RFC 009, the critical path"
          />
        </div>
      </Section>
    </MarketingShell>
  )
}
