import { cn } from '@/lib/utils'
import { MarketingShell, PageHero } from '../blocks'
import { RoadmapTimeline } from '../diagrams/RoadmapTimeline'
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
        body: 'Cited launch brief, plan, visuals and posts, review and revise. Early access.',
      },
      {
        title: 'Approval workflow',
        body: 'Approval enforced on the server, batch approval, and six roles.',
      },
      {
        title: 'Scheduled publishing',
        body: 'Scheduling that survives restarts, with confirmation from each network.',
      },
      {
        title: 'Structured launches',
        body: 'Launches, angles, and posts saved as records you can edit one at a time.',
      },
      {
        title: 'Brand and product pages',
        body: 'Brand profile and kits, and a map from features to product pages.',
      },
      {
        title: 'Workspaces, sign-in, and enterprise',
        body: 'Workspaces, roles, SSO, SCIM user provisioning, audit logs, and audit log export.',
      },
      {
        title: 'Release intake',
        body: 'The release form, signed webhooks, and asset uploads.',
      },
      {
        title: 'REST API and reference',
        body: 'The REST API at /api/v1, with OpenAPI at /openapi.json and an interactive reference at /api-reference.',
      },
      {
        title: 'Billing and credits',
        body: 'Stripe billing for Pro and Business, monthly AI credits, and extra credit packs.',
      },
      {
        title: 'GitHub App',
        body: 'Connect a repository. Merges are held for the next published release, and production deploys capture fresh screenshots.',
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
        body: 'The editor run as a service, so the app, the API, and the AI produce identical visuals.',
      },
      {
        title: 'Paste a URL, get a profile',
        body: 'Shots reads your site in the background and drafts a product profile with your ideal customers.',
      },
      {
        title: 'Step-by-step feature launches',
        body: 'A feature launch that runs as fixed steps and can resume where it stopped.',
      },
      {
        title: 'Safe marketing tools for the AI',
        body: 'About ten narrow tools the AI can use, with no access to servers or databases.',
      },
      {
        title: 'Chat and the workspace',
        body: 'Type one sentence to get a draft launch. Everything chat can do also works without it.',
      },
      {
        title: 'Four core workflows',
        body: 'Launch a product, ship a feature, stay visible every week, and get a first week of posts when you sign up.',
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
        body: 'Merged pull requests worth announcing become suggested launches.',
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
        body: 'Approval rules, then Manual, Copilot, and Autopilot modes.',
      },
    ],
  },
]

/** /roadmap: shipped, next, and later. */
export function RoadmapPage() {
  return (
    <MarketingShell finale={{ lead: 'Help decide', trail: 'what ships next.' }}>
      <PageHero
        body="Shipped work is marked shipped. Everything else is marked next or later. More automation comes last, and only as far as your approval rules allow."
        eyebrow={{ label: 'Roadmap' }}
        lead="Our roadmap, in public:"
        location="roadmap_hero"
        primary={{ href: '/design-partners', label: 'Become a design partner' }}
        secondary={{ href: '/changelog', label: 'Read the changelog' }}
        trail="what works today and what we are building next."
      />

      <Section>
        <div className="grid gap-px overflow-hidden border border-[#212121] bg-[#212121] md:grid-cols-3">
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
          body="Each version adds to the same workspace and the same launch records, so nothing you made has to start over."
          label="Generations"
          lead="Five versions of Shots,"
          trail="each built on the one before."
        />
        <div className="mt-24">
          <RoadmapTimeline />
        </div>
      </Section>

      <Section>
        <SectionIntro
          body="Billing with plan limits has shipped. The gap left between today and the full launch workflow is capturing logged-in pages. Until then, point Shots at a public staging or demo page."
          label="Open gaps"
          lead="One known gap:"
          trail="Shots can't capture pages behind a login yet."
        />
      </Section>
    </MarketingShell>
  )
}
