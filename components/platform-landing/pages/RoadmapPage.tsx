import { cn } from '@/lib/utils'
import { MarketingShell, PageHero, PullQuote } from '../blocks'
import { MONO, MUTED, Section, SectionIntro } from '../primitives'

type Item = { title: string; body: string }

const COLUMNS: { name: string; tone: string; note: string; items: Item[] }[] = [
  {
    name: 'Shipped',
    tone: 'text-emerald-400',
    note: 'In the product today',
    items: [
      {
        title: 'Launch intelligence',
        body: 'Cited spec, plan, visuals and copy, review and revise. Early access.',
      },
      {
        title: 'Approval workflow',
        body: 'Server-side states, batch approval, six roles.',
      },
      {
        title: 'Publishing abstraction',
        body: 'Durable scheduling with receipts behind one provider seam.',
      },
      {
        title: 'Campaign objects',
        body: 'Campaigns, angles, and posts as database objects.',
      },
      {
        title: 'Brand and product surfaces',
        body: 'Brand profile and kits, and the map from features to screens.',
      },
      {
        title: 'Tenancy, auth, and enterprise',
        body: 'Organizations, roles, SSO, SCIM, audit logs, and SIEM drains.',
      },
      {
        title: 'Release intake',
        body: 'Signed webhooks and the release and asset pipeline.',
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
      },
      {
        title: 'Paste a URL, get a profile',
        body: 'Product intelligence and a background onboarding agent with ideal customer profiles.',
      },
      {
        title: 'The launch recipe',
        body: 'A deterministic, resumable feature-launch pipeline.',
      },
      {
        title: 'Typed marketing tools',
        body: 'About ten domain tools for an agent with no infrastructure access.',
      },
      {
        title: 'Conversation and workspace',
        body: 'One sentence to a draft campaign, in a workspace that works without chat.',
      },
      {
        title: 'Three core workflows',
        body: 'Launch something, ship a feature, stay visible, and seven posts at onboarding.',
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
      },
      {
        title: 'Demo videos',
        body: 'Captioned demos from captured product flows.',
      },
      {
        title: 'Pillars and the weekly plan',
        body: 'Content pillars and a weekly plan approved in one action.',
      },
      {
        title: 'Research, analytics, feedback',
        body: 'Cited research, post performance, and plans weighted by what worked.',
      },
      {
        title: 'Policies and autonomy',
        body: 'Approval policies, then Manual, Copilot, and Autopilot modes.',
      },
    ],
  },
]

const GENERATIONS = [
  ['V1', 'The editor plus AI creative generation'],
  ['V2', 'URL to campaign'],
  ['V3', 'Product changes to campaigns, automatically'],
  ['V4', 'Campaign, publish, performance, next campaign'],
  ['V5', 'Marketing intelligence across GitHub, website, and analytics'],
] as const

/** /roadmap: shipped, now, next, and later. */
export function RoadmapPage() {
  return (
    <MarketingShell finale={{ lead: 'Help decide', trail: 'what ships next.' }}>
      <PageHero
        body="The plan is written down and public. Primitives first, then recipes, then the agent. Autonomy comes last, and only as far as your approval policies allow."
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
                    <div className="bg-[#111] p-4">
                      <span className="text-[15px] text-white">{item.title}</span>
                      <span className={cn('mt-1.5 block text-[13.5px] leading-[1.5]', MUTED)}>
                        {item.body}
                      </span>
                    </div>
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
            source="The critical path"
          />
        </div>
      </Section>
    </MarketingShell>
  )
}
