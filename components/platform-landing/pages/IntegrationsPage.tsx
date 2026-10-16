import {
  Analytics01Icon,
  BrowserIcon,
  ChartLineData01Icon,
  CommandLineIcon,
  CpuIcon,
  Database01Icon,
  GitPullRequestIcon,
  GithubIcon,
  GitlabIcon,
  GoogleIcon,
  Image01Icon,
  InstagramIcon,
  Key01Icon,
  Linkedin01Icon,
  Mail01Icon,
  MicrosoftIcon,
  NewTwitterIcon,
  Rocket01Icon,
  ServerStack01Icon,
  Share08Icon,
  UserGroupIcon,
  WebhookIcon,
  WorkflowSquare01Icon,
} from 'hugeicons-react'
import { cn } from '@/lib/utils'
import {
  AvailabilityPill,
  FaqBlock,
  HeroStage,
  LinkCards,
  MarketingShell,
  PageHero,
  type Availability,
} from '../blocks'
import { IntegrationsHub } from '../diagrams/IntegrationsHub'
import { MUTED, Section, SectionIntro } from '../primitives'

type Integration = {
  name: string
  icon: typeof GithubIcon
  status: Availability
  body: string
}

const CATEGORIES: { label: string; lead: string; trail: string; items: Integration[] }[] = [
  {
    label: 'Intake',
    lead: 'Where releases',
    trail: 'come from.',
    items: [
      {
        name: 'GitHub releases',
        icon: GithubIcon,
        status: 'Available',
        body: 'A signed repository webhook creates a release and links its release page as a source.',
      },
      {
        name: 'GitLab releases',
        icon: GitlabIcon,
        status: 'Available',
        body: 'Signed release webhooks, deduplicated and linked to the release page.',
      },
      {
        name: 'Any pipeline',
        icon: WebhookIcon,
        status: 'Available',
        body: 'Sign your own events with an HMAC signature, timestamp, and event ID.',
      },
      {
        name: 'REST API',
        icon: CommandLineIcon,
        status: 'Available',
        body: 'POST /api/v1/releases from CI with a scoped key and an idempotency key.',
      },
      {
        name: 'GitHub App',
        icon: GitPullRequestIcon,
        status: 'Available',
        body: 'Connect a repository. Merges are held for the next published release, which arrives with its notes and linked pull requests.',
      },
      {
        name: 'Deploy captures',
        icon: Rocket01Icon,
        status: 'Available',
        body: 'A successful production deploy on GitHub captures fresh screenshots of your registered product pages.',
      },
    ],
  },
  {
    label: 'Distribution',
    lead: 'Where launches',
    trail: 'land.',
    items: [
      {
        name: 'X',
        icon: NewTwitterIcon,
        status: 'Early access',
        body: 'Scheduled posts with one image, confirmed by the network.',
      },
      {
        name: 'LinkedIn',
        icon: Linkedin01Icon,
        status: 'Early access',
        body: 'Scheduled posts with one image, confirmed by the network.',
      },
      {
        name: 'Instagram',
        icon: InstagramIcon,
        status: 'Early access',
        body: 'Instagram Login, or Facebook Login with Page selection.',
      },
      {
        name: 'Release email',
        icon: Mail01Icon,
        status: 'Early access',
        body: 'Release emails to subscribers who opted in, delivered through Resend, once per address.',
      },
      {
        name: 'Buffer and Post Bridge',
        icon: Share08Icon,
        status: 'Planned',
        body: 'More destinations behind the same delivery guarantees.',
      },
      {
        name: 'Post analytics',
        icon: ChartLineData01Icon,
        status: 'Planned',
        body: 'Performance snapshots normalized across networks.',
      },
    ],
  },
  {
    label: 'Identity and audit',
    lead: 'Sign-in, single sign-on,',
    trail: 'and audit log export.',
    items: [
      {
        name: 'Google',
        icon: GoogleIcon,
        status: 'Available',
        body: 'Sign in with Google.',
      },
      {
        name: 'Microsoft',
        icon: MicrosoftIcon,
        status: 'Available',
        body: 'Sign in with Microsoft Entra ID.',
      },
      {
        name: 'GitHub sign-in',
        icon: GithubIcon,
        status: 'Available',
        body: 'Sign in with GitHub.',
      },
      {
        name: 'SAML and OIDC',
        icon: Key01Icon,
        status: 'Available',
        body: 'Single sign-on with your identity provider. Enterprise.',
      },
      {
        name: 'SCIM',
        icon: UserGroupIcon,
        status: 'Available',
        body: 'SCIM user provisioning and deprovisioning. Enterprise.',
      },
      {
        name: 'Splunk, Datadog, HTTPS',
        icon: Database01Icon,
        status: 'Available',
        body: 'Signed audit log export to your security log tool (SIEM). Enterprise.',
      },
    ],
  },
  {
    label: 'Under the hood',
    lead: 'What powers the AI,',
    trail: 'rendering, storage, and delivery.',
    items: [
      {
        name: 'Claude via OpenRouter',
        icon: CpuIcon,
        status: 'Available',
        body: 'Opus 5.5, Sonnet 5.5, and Haiku 4.5 by role, each configurable.',
      },
      {
        name: 'Temporal',
        icon: WorkflowSquare01Icon,
        status: 'Available',
        body: 'Workflows that survive restarts, for scheduled posts and maintenance.',
      },
      {
        name: 'Cloudflare Browser Rendering',
        icon: BrowserIcon,
        status: 'Available',
        body: 'Headless Chromium for rendering visuals, with no customer credentials.',
      },
      {
        name: 'Cloudflare R2',
        icon: ServerStack01Icon,
        status: 'Available',
        body: 'Private storage, kept separate for each workspace.',
      },
      {
        name: 'Microlink',
        icon: Image01Icon,
        status: 'Available',
        body: 'Captures of public pages, with private addresses blocked.',
      },
      {
        name: 'PostHog',
        icon: Analytics01Icon,
        status: 'Available',
        body: 'Product analytics for the hosted platform.',
      },
    ],
  },
]

/** The items of one category, for the hero hub diagram. */
const categoryItems = (label: string) =>
  (CATEGORIES.find((category) => category.label === label)?.items ?? []).map(
    ({ name, status }) => ({ name, status })
  )

/** /integrations: every connection, marked available, early access, or planned. */
export function IntegrationsPage() {
  return (
    <MarketingShell
      finale={{ lead: "Need a tool we don't connect to yet?", trail: 'Tell us which one.' }}
    >
      <PageHero
        body="Releases come in from GitHub, GitLab, your pipeline, or the API. Launches go out to X, LinkedIn, Instagram, and the inbox. Identity and audit plug into the tools your security team already runs."
        eyebrow={{ label: 'Integrations' }}
        lead="Connect GitHub, GitLab, and your pipeline,"
        location="integrations_hero"
        primary={{ href: '/product/release-intake', label: 'Release intake' }}
        secondary={{ href: '/contact', label: 'Request an integration' }}
        trail="then publish to X, LinkedIn, Instagram, and email."
      >
        <HeroStage>
          <IntegrationsHub
            distribution={categoryItems('Distribution')}
            intake={categoryItems('Intake')}
          />
        </HeroStage>
      </PageHero>
      {CATEGORIES.map((category) => (
        <Section key={category.label}>
          <SectionIntro label={category.label} lead={category.lead} trail={category.trail} />
          <ul className="mt-24 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {category.items.map(({ body, icon: Icon, name, status }) => (
              <li className="flex flex-col bg-[#111] p-7" key={name}>
                <div className="flex items-start justify-between gap-4">
                  <Icon aria-hidden="true" className="size-6 text-white" />
                  <AvailabilityPill status={status} />
                </div>
                <h3 className="mt-10 text-xl text-white">{name}</h3>
                <p className={cn('mt-2 text-[15px] leading-[1.55]', MUTED)}>{body}</p>
              </li>
            ))}
          </ul>
        </Section>
      ))}

      <FaqBlock
        items={[
          {
            q: 'What does early access mean for social channels?',
            a: "Delivery is built and tested. During early access we connect each workspace's channels with you and verify the first posts together.",
          },
          {
            q: 'Do you have Slack or Zapier integrations?',
            a: 'Not today. The REST API and signed webhooks cover most automation. Tell us what you need.',
          },
          {
            q: 'Can I bring my own model provider?',
            a: 'Self-hosted deployments choose the model for each role through configuration.',
          },
        ]}
      />

      <Section>
        <SectionIntro
          label="Related"
          lead="Read how releases arrive,"
          trail="how posts are published, and what Enterprise adds."
        />
        <div className="mt-24">
          <LinkCards paths={['/product/release-intake', '/product/publishing', '/enterprise']} />
        </div>
      </Section>
    </MarketingShell>
  )
}
