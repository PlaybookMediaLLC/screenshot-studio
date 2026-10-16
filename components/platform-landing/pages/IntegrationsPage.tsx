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
  LinkCards,
  MarketingShell,
  PageHero,
  type Availability,
} from '../blocks'
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
        status: 'Planned',
        body: 'Merged pull requests worth announcing become suggested launches.',
      },
      {
        name: 'Deploy webhooks',
        icon: Rocket01Icon,
        status: 'Planned',
        body: 'Successful deploys trigger fresh captures of the screens that changed.',
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
        body: 'Scheduled posts with one image and a stored receipt.',
      },
      {
        name: 'LinkedIn',
        icon: Linkedin01Icon,
        status: 'Early access',
        body: 'Scheduled posts with one image and a stored receipt.',
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
        body: 'Consented announcements delivered through Resend, once per address.',
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
    lead: 'Who gets in,',
    trail: 'and who is watching.',
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
        body: 'Automatic provisioning and deprovisioning. Enterprise.',
      },
      {
        name: 'Splunk, Datadog, HTTPS',
        icon: Database01Icon,
        status: 'Available',
        body: 'Signed audit drains to your SIEM. Enterprise.',
      },
    ],
  },
  {
    label: 'Under the hood',
    lead: 'What does',
    trail: 'the work.',
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
        body: 'Durable workflows for scheduled posts and maintenance.',
      },
      {
        name: 'Cloudflare Browser Rendering',
        icon: BrowserIcon,
        status: 'Available',
        body: 'Headless Chromium for design renders, with no customer credentials.',
      },
      {
        name: 'Cloudflare R2',
        icon: ServerStack01Icon,
        status: 'Available',
        body: 'Private, organization-scoped asset storage.',
      },
      {
        name: 'Microlink',
        icon: Image01Icon,
        status: 'Available',
        body: 'Capture for public pages, behind SSRF checks.',
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

/** /integrations: every connection, marked available, early access, or planned. */
export function IntegrationsPage() {
  return (
    <MarketingShell finale={{ lead: 'Starts where you ship.', trail: 'Ends where users read.' }}>
      <PageHero
        body="Releases come in from GitHub, GitLab, your pipeline, or the API. Launches go out to X, LinkedIn, Instagram, and the inbox. Identity and audit plug into the tools your security team already runs."
        eyebrow={{ label: 'Integrations' }}
        lead="Starts where you ship."
        location="integrations_hero"
        primary={{ href: '/product/release-intake', label: 'Release intake' }}
        secondary={{ href: '/contact', label: 'Request an integration' }}
        trail="Ends where your users read."
      />
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
            a: 'Delivery is built and tested. During early access we connect each workspace’s channels with you and verify the first posts together.',
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
        <SectionIntro label="Related" lead="Keep reading." trail="Every part connects." />
        <div className="mt-24">
          <LinkCards paths={['/product/release-intake', '/product/publishing', '/enterprise']} />
        </div>
      </Section>
    </MarketingShell>
  )
}
