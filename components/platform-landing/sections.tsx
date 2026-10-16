import Link from 'next/link'
import {
  ArrowUpRight01Icon,
  Database01Icon,
  FingerPrintIcon,
  Key01Icon,
  LockIcon,
  Mail01Icon,
  ServerStack01Icon,
  Shield01Icon,
  UserGroupIcon,
  WorkflowSquare01Icon,
  Linkedin01Icon,
  InstagramIcon,
  NewTwitterIcon,
  Note01Icon,
  Rocket01Icon,
} from 'hugeicons-react'
import { z } from 'zod'
import { LAUNCH_CHANNELS, SPEC_SECTIONS } from '@/lib/launch/spec-schema'
import { atLeast, PRODUCT_FACTS } from '@/lib/seo/product-facts'
import { cn } from '@/lib/utils'
import { ArrowLink, FaqBlock } from './blocks'
import { CodeTabs } from './CodeTabs'
import { PlanCards } from './pricing'
import { CreativeMock } from './WorkflowSection'
import {
  Check,
  CONTAINER,
  MONO,
  MUTED,
  Section,
  SectionIntro,
  Stage,
  Tag,
  Window,
} from './primitives'

// ---------------------------------------------------------------- stats --

const STATS = [
  { value: String(SPEC_SECTIONS.length), label: 'sections in every cited launch spec' },
  { value: String(LAUNCH_CHANNELS.length), label: 'channels drafted from one release' },
  { value: '0', label: 'posts published without a human approval' },
]

/** Sim-style statement with large figures on hairline rows. */
export function StatsSection() {
  return (
    <section className={cn(CONTAINER, 'py-24 sm:py-32')}>
      <div className="grid gap-12 lg:grid-cols-2 lg:gap-24">
        <p className="text-balance text-[24px] leading-[1.3] tracking-[-0.015em] text-white sm:text-[30px]">
          You ship every week. The announcement ships when someone finds a free afternoon.{' '}
          <span className={MUTED}>
            Shots turns the release you already wrote into the launch you never had time
            to make.
          </span>
        </p>
        <dl className="divide-y divide-[#212121] border-y border-[#212121]">
          {STATS.map((stat) => (
            <div className="flex items-end justify-between gap-8 py-7" key={stat.label}>
              <dt className="sr-only">{stat.label}</dt>
              <dd className="text-[64px] leading-[0.95] tracking-[-0.045em] text-white sm:text-[84px]">
                {stat.value}
              </dd>
              <dd className={cn('max-w-[220px] pb-2 text-right text-base', MUTED)}>{stat.label}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------- problem --

const WITHOUT = [
  'Crop the screenshot, again',
  'Hunt for the brand hex code',
  'Write five versions of one announcement',
  'Paste each into a different tool',
  'Chase a teammate for sign-off',
  'Hope nothing claims what the product cannot do',
]

const WITH = [
  'Describe the release once, or let GitHub send it',
  'Check a brief where every claim cites a source',
  'Approve a plan for every channel',
  'Review real screenshots, framed on brand',
  'Approve seven posts in one click',
  'Ship on schedule, with a receipt',
]

/** The gap between shipping and announcing, as a before and after. */
export function ProblemSection() {
  return (
    <Section>
      <SectionIntro
        body="The feature is live. The changelog is a commit message. The screenshot sits in Slack, and the post is a draft nobody approved. Users never hear about the work, so the work never pays you back."
        label="The gap"
        lead="Shipping happens by default."
        trail="Launching happens by design."
      />
      <div className="mt-24 grid gap-4 md:grid-cols-2">
        <div className="border border-[#212121] p-8 sm:p-12">
          <p className={cn('text-[15px]', MUTED)}>Every release, by hand</p>
          <ul className="mt-8 space-y-4">
            {WITHOUT.map((item) => (
              <li
                className="flex items-center gap-4 text-lg text-white/55 line-through decoration-white/20"
                key={item}
              >
                <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-white/25" />
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div className="bg-[#111] p-8 sm:p-12">
          <p className={cn('text-[15px]', MUTED)}>Every release, with Shots</p>
          <ul className="mt-8 space-y-4">
            {WITH.map((item) => (
              <li className="flex items-center gap-4 text-lg text-white" key={item}>
                <Check />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------- engine --

/** A browser-framed product shot. */
export function BrowserWidget() {
  return (
    <Window className="w-full max-w-[300px]" meta="Safari · dark" title="Browser frame">
      <CreativeMock className="aspect-[16/11]" />
    </Window>
  )
}

const SWATCHES = ['#0a0a0a', '#3d3d3d', '#9a9a9a', '#f4f4f4', '#34d399']

/** A brand kit card with swatches and type. */
export function BrandWidget() {
  return (
    <Window className="w-full max-w-[300px]" meta="v3" title="Brand kit · Acme">
      <div className="p-4">
        <div className="flex gap-2">
          {SWATCHES.map((color) => (
            <span
              className="size-8 rounded-full border border-white/10"
              key={color}
              style={{ background: color }}
            />
          ))}
        </div>
        <div className="mt-4 flex items-baseline justify-between text-[13px]">
          <span className="text-[#858585]">Heading</span>
          <span className="text-lg tracking-[-0.02em] text-white">Geist 500</span>
        </div>
        <div className="mt-2 flex items-baseline justify-between text-[13px]">
          <span className="text-[#858585]">Applied to</span>
          <span className="text-white">4 designs</span>
        </div>
      </div>
    </Window>
  )
}

/** An animation timeline with export formats. */
export function TimelineWidget() {
  return (
    <Window className="w-full max-w-[300px]" meta="00:08" title="Timeline">
      <div className="space-y-2.5 p-4">
        {[
          [8, 46, 78],
          [20, 60],
          [32, 70, 90],
        ].map((keys, row) => (
          <div className="relative h-5 rounded bg-white/[0.05]" key={row}>
            {keys.map((left) => (
              <span
                className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-white"
                key={left}
                style={{ left: `${left}%` }}
              />
            ))}
          </div>
        ))}
        <div className="flex gap-1.5 pt-1">
          {['MP4', 'WebM', 'GIF'].map((format) => (
            <Tag key={format}>{format}</Tag>
          ))}
        </div>
      </div>
    </Window>
  )
}

const ENGINE = [
  {
    title: 'Real screens, framed',
    body: 'Safari and Chrome mockups, Arc, macOS, and Windows frames, device shells, and 3D perspective. The capture tool shoots your live product.',
    widget: <BrowserWidget />,
  },
  {
    title: 'Your brand, applied',
    body: 'Every design takes your kit: the background gradient, the accent, the text color, the nearest font. Nobody picks a hex code twice.',
    widget: <BrandWidget />,
  },
  {
    title: 'Motion when it matters',
    body: `${PRODUCT_FACTS.animationPresets} animation presets on a keyframe timeline, exported as MP4, WebM, or GIF in the browser.`,
    widget: <TimelineWidget />,
  },
]

const ENGINE_FACTS = [
  `${atLeast(PRODUCT_FACTS.backgrounds)} backgrounds`,
  `Export up to ${PRODUCT_FACTS.maxExportScale}x`,
  'Annotations and blur',
  'App Store screenshots',
  'Templates with your media',
  `${PRODUCT_FACTS.license} licensed`,
]

/** The editor as the platform's rendering engine. */
export function EngineSection() {
  return (
    <Section id="editor">
      <SectionIntro
        body="Every visual the agents make is an editor design, not a flat image. Open it, move anything by hand, and save it back to the workspace."
        label="Creative engine"
        lead="Real screenshots."
        trail="Not stock art."
      >
        <div className="mt-10">
          <ArrowLink href="/product/creative-engine">See the creative engine</ArrowLink>
        </div>
      </SectionIntro>
      <div className="mt-24 grid gap-4 md:grid-cols-3">
        {ENGINE.map((card, index) => (
          <div key={card.title}>
            <Stage className="aspect-[405/320] items-center p-8" variant={index + 1}>
              {card.widget}
            </Stage>
            <h3 className="mt-7 text-xl tracking-[-0.015em] text-white">{card.title}</h3>
            <p className={cn('mt-2 text-base leading-[1.55]', MUTED)}>{card.body}</p>
          </div>
        ))}
      </div>
      <ul className="mt-16 grid grid-cols-2 gap-px overflow-hidden border border-[#212121] bg-[#212121] sm:grid-cols-3 lg:grid-cols-6">
        {ENGINE_FACTS.map((fact) => (
          <li className="bg-[#090909] px-5 py-5 text-[15px] text-white/80" key={fact}>
            {fact}
          </li>
        ))}
      </ul>
    </Section>
  )
}

// ---------------------------------------------------------------- approval --

const FLOW = [
  { who: 'creator', what: 'Submits 7 posts for review' },
  { who: 'approver', what: 'Approves all 7 in one transaction' },
  { who: 'publisher', what: 'Schedules approved posts only' },
]

const ROLES = [
  { role: 'owner', can: 'Billing, SSO, roles, everything' },
  { role: 'admin', can: 'Members, brand, channels, releases' },
  { role: 'creator', can: 'Create releases, edit drafts, submit' },
  { role: 'approver', can: 'Approve, reject, request changes' },
  { role: 'publisher', can: 'Schedule and cancel approved posts' },
  { role: 'viewer', can: 'Read everything, change nothing' },
]

/** Approval as a server-side gate, shown as a flow and a role table. */
export function ApprovalSection() {
  return (
    <Section>
      <SectionIntro
        body="Approval is a state machine on the server, not a checkbox in the UI. The same rules run for the browser, the API, and every agent. An API key can create a release. It cannot approve a post."
        label="Approval"
        lead="Machines draft."
        trail="People decide."
      >
        <div className="mt-10">
          <ArrowLink href="/product/approvals">How approval works</ArrowLink>
        </div>
      </SectionIntro>
      <div className="mt-24 grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col items-center border border-[#212121] px-6 py-14 sm:px-12">
          <div className="w-full max-w-[340px] bg-[#111] px-5 py-4">
            <p className="text-[15px] text-white">Copy agent</p>
            <p className={cn('text-sm', MUTED)}>Drafted 7 posts for Recurring invoices</p>
          </div>
          <span aria-hidden="true" className="my-4 h-8 w-px bg-white/30" />
          <div className="w-full max-w-[340px] bg-[#181818] py-3.5 text-center text-[15px] text-white">
            Server-side approval
          </div>
          <ul className="w-full max-w-[340px] space-y-px bg-[#111] p-2">
            {FLOW.map((step) => (
              <li className="flex items-center gap-3 px-3 py-3" key={step.who}>
                <Check />
                <span className="flex-1 text-[15px] text-white">{step.what}</span>
                <span className={cn(MONO, 'text-[11px]', MUTED)}>{step.who}</span>
              </li>
            ))}
          </ul>
          <span aria-hidden="true" className="my-4 h-8 w-px bg-white/30" />
          <div className="w-full max-w-[340px] bg-[#111] px-5 py-4">
            <p className="text-[15px] text-white">
              Published <span className="text-emerald-400">with receipt</span>
            </p>
            <p className={cn(MONO, 'mt-1 text-[11.5px]', MUTED)}>1 audit entry · postCount: 7</p>
          </div>
        </div>
        <div className="flex flex-col justify-between bg-[#111] p-8 sm:p-12">
          <div>
            <p className="text-balance text-[24px] leading-[1.35] tracking-[-0.02em] text-white sm:text-[28px]">
              Agents draft. People decide.{' '}
              <span className={MUTED}>
                The audit log keeps the record, in the same transaction.
              </span>
            </p>
          </div>
          <dl className="mt-12 divide-y divide-[#212121] border-t border-[#212121]">
            {ROLES.map((row) => (
              <div className="flex items-baseline justify-between gap-6 py-3.5" key={row.role}>
                <dt className={cn(MONO, 'text-[13px] text-white')}>{row.role}</dt>
                <dd className={cn('text-right text-[15px]', MUTED)}>{row.can}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------- publishing --

const CHANNELS = [
  { name: 'X', icon: NewTwitterIcon, mode: 'Scheduled' },
  { name: 'LinkedIn', icon: Linkedin01Icon, mode: 'Scheduled' },
  { name: 'Instagram', icon: InstagramIcon, mode: 'Scheduled' },
  { name: 'Email', icon: Mail01Icon, mode: 'Announced' },
  { name: 'Product Hunt', icon: Rocket01Icon, mode: 'Drafted' },
  { name: 'Changelog', icon: Note01Icon, mode: 'Drafted' },
]

const LOG = [
  { id: 'post_8f2a', path: 'SCHEDULED → PROCESSING → PUBLISHED', tone: 'text-emerald-300' },
  { id: 'post_91c4', path: 'retry 429 → PUBLISHED, once', tone: 'text-emerald-300' },
  { id: 'post_a07e', path: 'UNKNOWN_DELIVERY → held for a person', tone: 'text-amber-200' },
]

/** A delivery log: a clean publish, a safe retry, and an uncertain delivery held for review. */
export function DeliveryLog() {
  return (
    <Window className="w-full max-w-[460px]" meta="Temporal" title="Delivery log">
      <ul className={cn(MONO, 'divide-y divide-white/[0.06] text-[12px]')}>
        {LOG.map((line) => (
          <li className="flex flex-col gap-1 px-4 py-3" key={line.id}>
            <span className="text-white/50">{line.id}</span>
            <span className={line.tone}>{line.path}</span>
          </li>
        ))}
      </ul>
    </Window>
  )
}

/** Durable delivery and the channels a launch reaches. */
export function PublishingSection() {
  return (
    <Section>
      <SectionIntro
        body="Approved posts run on durable workflows. At send time each post is checked again: approval, asset, workspace, destination. It is marked published only when the network returns a receipt. An uncertain delivery goes to a person, never back into the queue."
        label="Publishing"
        lead="Scheduled once."
        trail="Published exactly once."
      >
        <div className="mt-10">
          <ArrowLink href="/product/publishing">How publishing works</ArrowLink>
        </div>
      </SectionIntro>
      <div className="mt-24 grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {CHANNELS.map(({ icon: Icon, mode, name }) => (
            <li className="flex aspect-[4/3] flex-col justify-between bg-[#111] p-5" key={name}>
              <div className="flex items-start justify-between">
                <Icon aria-hidden="true" className="size-6 text-white" />
                <span className={cn('text-[12px]', MUTED)}>{mode}</span>
              </div>
              <p className="text-[17px] text-white">{name}</p>
            </li>
          ))}
        </ul>
        <Stage className="items-center p-6 sm:p-10" variant={2}>
          <DeliveryLog />
        </Stage>
      </div>
      <p className={cn('mt-8 max-w-[760px] text-[15px] leading-[1.6]', MUTED)}>
        Channel connections are set up with you during early access. Release emails go only to
        subscribers who consented, with one-click unsubscribe and exactly one delivery per address.
      </p>
    </Section>
  )
}

// ---------------------------------------------------------------- guardrails --

const GUARDS = [
  {
    title: 'Prompt-injection defense',
    body: 'Scripts, hidden text, and zero-width characters are stripped. Text that reads like orders to an AI is flagged and shown to the reviewer.',
    snippet: '<source id="S2" trust="untrusted">',
  },
  {
    title: 'SSRF-safe fetching',
    body: 'Public http(s) only. Every resolved address is checked, every redirect re-checked, and every response capped in size and time.',
    snippet: 'redirect hop → resolve → public? yes',
  },
  {
    title: 'Citations enforced',
    body: 'A claim that cites nothing, or a source that does not exist, is removed and turned into an open question.',
    snippet: 'proofPoints.2 → openQuestions.0',
  },
  {
    title: 'Copy guards',
    body: 'Channel limits, hype words, your prohibited terms, unknown links, and uncited claims are rejected. The model gets the reason and fixes the post.',
    snippet: 'x: 291 > 280 · rewrite',
  },
  {
    title: 'Stages without side effects',
    body: 'Stages that read sources cannot act. The workspace comes from your session, never from model output or a crawled page.',
    snippet: 'tools: [] · workspace: session',
  },
  {
    title: 'Metered and audited',
    body: 'Each model call is charged AI credits for what it costs, is rate-limited per workspace, and writes an audit event with the model and usage.',
    snippet: 'launch.spec · model · tokens',
  },
]

/** How untrusted release sources are handled before and after the model. */
export function GuardrailsSection() {
  return (
    <Section>
      <SectionIntro
        body="Release notes, pull requests, and web pages can carry instructions aimed at an AI. Every source is cleaned, fenced, and flagged before a model reads it, and every output is checked before it is saved."
        label="Guardrails"
        lead="Sources are evidence."
        trail="Never instructions."
      >
        <div className="mt-10">
          <ArrowLink href="/product/guardrails">Read about the guardrails</ArrowLink>
        </div>
      </SectionIntro>
      <ul className="mt-24 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {GUARDS.map((guard) => (
          <li className="flex flex-col bg-[#111] p-8 sm:p-10" key={guard.title}>
            <code className={cn(MONO, 'truncate text-[12px] text-white/50')}>{guard.snippet}</code>
            <h3 className="mt-14 text-[22px] tracking-[-0.015em] text-white">{guard.title}</h3>
            <p className={cn('mt-3 text-base leading-[1.55]', MUTED)}>{guard.body}</p>
          </li>
        ))}
      </ul>
    </Section>
  )
}

// ---------------------------------------------------------------- developers --

const DEV_LINKS = [
  { href: '/api-reference', title: 'API reference', body: 'Every operation, live in Scalar.' },
  {
    href: '/openapi.json',
    title: 'OpenAPI 3.1',
    body: 'Generated from the same Zod contracts the routes run.',
  },
  {
    href: '/docs/authentication',
    title: 'Scoped keys',
    body: 'Five scopes. Keys create, never approve or publish.',
  },
  {
    href: '/llms.txt',
    title: 'llms.txt',
    body: 'Markdown for agents. Supported pages answer Accept: text/markdown.',
  },
]

/** REST intake, webhooks, and machine-readable docs. */
export function DevelopersSection() {
  return (
    <Section id="developers">
      <SectionIntro
        body="Send a release from CI, a deploy hook, or a signed webhook. Idempotency keys make retries safe. The release waits in your workspace, ready to become a campaign."
        label="Developers"
        lead="Releases in."
        trail="From any pipeline."
      >
        <div className="mt-10">
          <ArrowLink href="/product/release-intake">Explore release intake</ArrowLink>
        </div>
      </SectionIntro>
      <Stage className="mt-24 px-4 py-12 sm:px-12 sm:py-20" variant={3}>
        <div className="w-full min-w-0 max-w-[760px]">
          <CodeTabs />
        </div>
      </Stage>
      <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {DEV_LINKS.map((link) => (
          <li key={link.href}>
            <Link
              className="group flex h-full flex-col justify-between gap-10 bg-[#111] p-6 transition-colors hover:bg-[#161616]"
              href={link.href}
            >
              <ArrowUpRight01Icon
                aria-hidden="true"
                className="size-5 self-end text-[#858585] transition-colors group-hover:text-white"
              />
              <span>
                <span className="block text-lg text-white">{link.title}</span>
                <span className={cn('mt-1 block text-[15px] leading-[1.5]', MUTED)}>
                  {link.body}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  )
}

// ---------------------------------------------------------------- security --

const CONTROLS = [
  {
    icon: Key01Icon,
    title: 'SSO and SCIM',
    body: 'SAML and OIDC single sign-on, SCIM provisioning and deprovisioning.',
  },
  {
    icon: UserGroupIcon,
    title: 'Six fixed roles',
    body: 'Owner, admin, creator, approver, publisher, viewer. Least privilege by default.',
  },
  {
    icon: Database01Icon,
    title: 'Append-only audit log',
    body: 'The app can insert and read audit rows, never edit or delete them. IPs are hashed.',
  },
  {
    icon: WorkflowSquare01Icon,
    title: 'SIEM drains',
    body: 'Signed CloudEvents to any endpoint, or presets for Splunk and Datadog.',
  },
  {
    icon: Shield01Icon,
    title: 'Retention and legal hold',
    body: 'Ninety days by default. Longer retention and legal hold on Enterprise.',
  },
  {
    icon: LockIcon,
    title: 'Private storage',
    body: 'Files namespaced per organization. Signed URLs expire in two minutes. Uploads are write-once.',
  },
  {
    icon: FingerPrintIcon,
    title: 'Two-factor',
    body: 'TOTP, required to connect social channels and to configure SSO.',
  },
  {
    icon: Shield01Icon,
    title: 'Tenant isolation',
    body: 'Tenancy comes from the signed-in principal, never from input. Foreign IDs return 404, proven by a two-tenant test.',
  },
  {
    icon: ServerStack01Icon,
    title: 'Self-hosting',
    body: 'Docker images and a Helm chart in the open-source repository.',
  },
]

/** Enterprise controls as a sim-style hairline capability grid. */
export function SecuritySection() {
  return (
    <Section id="security">
      <SectionIntro
        body="Built on Better Auth organizations with one authorization path for every request. Each control below is documented in the repository, down to the database role."
        label="Security"
        lead="Ready for the security review."
        trail="Every control, documented."
      >
        <div className="mt-10">
          <ArrowLink href="/security">Visit the security page</ArrowLink>
        </div>
      </SectionIntro>
      <ul className="mt-24 grid gap-px overflow-hidden rounded-xl border border-[#212121] bg-[#212121] sm:grid-cols-2 lg:grid-cols-3">
        {CONTROLS.map(({ body, icon: Icon, title }) => (
          <li className="bg-[#090909] p-7" key={title}>
            <Icon aria-hidden="true" className="size-5 text-white/80" strokeWidth={1.5} />
            <h3 className="mt-6 text-base text-white">{title}</h3>
            <p className={cn('mt-1.5 text-[15px] leading-[1.55]', MUTED)}>{body}</p>
          </li>
        ))}
      </ul>
    </Section>
  )
}

// ---------------------------------------------------------------- roadmap --

/** Delivery state of a roadmap item. */
export const roadmapStatusSchema = z.enum(['Shipped', 'Next', 'Planned'])

/** Delivery state of a roadmap item. */
export type RoadmapStatus = z.infer<typeof roadmapStatusSchema>

const RS = roadmapStatusSchema.enum

const ROADMAP: { status: RoadmapStatus; title: string; body: string }[] = [
  {
    status: RS.Shipped,
    title: 'Launch intelligence',
    body: 'Release, cited spec, plan, visuals and copy, review and revise.',
  },
  {
    status: RS.Shipped,
    title: 'Workspace and assets',
    body: 'Save designs to the workspace, reopen them in the editor, save again.',
  },
  {
    status: RS.Shipped,
    title: 'Release intake API',
    body: 'REST, scoped keys, idempotency, and signed GitHub and GitLab webhooks.',
  },
  {
    status: RS.Next,
    title: 'Paste a URL, get seven posts',
    body: 'A reviewable product profile in seconds and a first week of posts in minutes.',
  },
  {
    status: RS.Planned,
    title: 'Merged PR to suggested launch',
    body: 'A pull request worth announcing becomes a suggestion, never an automatic post.',
  },
  {
    status: RS.Planned,
    title: 'Screenshots after every deploy',
    body: 'Fresh captures of changed screens, with before and after pairs.',
  },
  {
    status: RS.Planned,
    title: 'Demo videos',
    body: 'Short, captioned demos rendered from captured product flows.',
  },
  {
    status: RS.Planned,
    title: 'The weekly plan',
    body: 'Monday morning: one plan, seven posts, one approval.',
  },
  {
    status: RS.Planned,
    title: 'Copilot and Autopilot',
    body: 'Proactive suggestions, then policy-bound publishing you switch on.',
  },
]

/** What ships today and what comes next, stated plainly. */
export function RoadmapSection() {
  return (
    <Section>
      <SectionIntro
        body="The plan is public and written down. Primitives first, then recipes, then the agent. Autonomy comes last, and only as far as your approval policies allow."
        label="Roadmap"
        lead="Today you bring the release."
        trail="Next, your product brings it."
      >
        <div className="mt-10">
          <ArrowLink href="/roadmap">See the full roadmap</ArrowLink>
        </div>
      </SectionIntro>
      <ol className="mt-24 border-t border-[#212121]">
        {ROADMAP.map((item) => (
          <li
            className="grid gap-2 border-b border-[#212121] py-6 sm:grid-cols-[140px_1fr_1.4fr] sm:items-baseline sm:gap-8"
            key={item.title}
          >
            <span
              className={cn(
                MONO,
                'text-[12px] uppercase tracking-[0.06em]',
                item.status === RS.Shipped
                  ? 'text-emerald-400'
                  : item.status === RS.Next
                    ? 'text-white'
                    : MUTED
              )}
            >
              {item.status}
            </span>
            <span className="text-lg text-white">{item.title}</span>
            <span className={cn('text-base', MUTED)}>{item.body}</span>
          </li>
        ))}
      </ol>
    </Section>
  )
}

// ---------------------------------------------------------------- pricing --

/** Plan cards from the entitlement code, with a link to the full comparison. */
export function PricingSection() {
  return (
    <Section id="pricing">
      <SectionIntro
        body="The editor is free. Paid plans raise every limit, and Enterprise adds the controls a security review asks for."
        label="Pricing"
        lead="Start free."
        trail="Grow into the platform."
      >
        <div className="mt-10">
          <ArrowLink href="/pricing">Compare every plan</ArrowLink>
        </div>
      </SectionIntro>
      <div className="mt-24">
        <PlanCards location="landing_pricing" />
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------- faq --

const FAQS = [
  {
    q: 'What is Shots?',
    a: 'A launch platform for software teams. You describe a release, or send it from GitHub. It drafts a cited brief, plans the campaign, designs visuals from your real product, and writes channel-ready posts. You approve before anything goes out. Underneath sits the open-source screenshot editor, which stays free.',
  },
  {
    q: 'Will it ever post without me?',
    a: 'No. Approval is enforced on the server. Agents and API keys can create drafts. Only signed-in members move posts to review, only members with approval rights can approve, and only approved posts can be scheduled.',
  },
  {
    q: 'Where do the screenshots come from?',
    a: 'Your live product. The capture tool photographs the product URL and the release source links, then composes the result in the editor with your brand kit. Pages behind a login are not supported yet.',
  },
  {
    q: 'How does it avoid making things up?',
    a: `Every claim in the ${SPEC_SECTIONS.length}-section spec cites the brief or a source. A claim with no source is removed and becomes an open question for you. Posts may only cite claims the spec contains, and posts that break that rule are rejected.`,
  },
  {
    q: 'Which channels does it cover?',
    a: 'Copy for X, LinkedIn, Instagram, Product Hunt, your changelog, and email. Scheduled delivery to X, LinkedIn, and Instagram is in early access, and channel connections are set up with you.',
  },
  {
    q: 'Can I edit what it makes?',
    a: 'Yes. Edit copy inline, open any visual in the full editor, or ask for a revision and apply it from a diff. Nothing you approved changes on its own.',
  },
  {
    q: 'Do you train models on my content?',
    a: 'No. Shots learns your taste by retrieving your own workspace history at generation time: approved posts, rejected posts with notes, and applied revisions. Nothing is shared across workspaces.',
  },
  {
    q: 'Is the editor still free and open source?',
    a: `Yes. The editor is ${PRODUCT_FACTS.license} licensed, available on a free workspace plan, and exports carry no watermark.`,
  },
]

/** Questions people ask before a demo. */
export function FaqSection() {
  return <FaqBlock items={FAQS} />
}
