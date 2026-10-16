import Link from 'next/link'
import {
  Database01Icon,
  FingerPrintIcon,
  Key01Icon,
  LockIcon,
  ServerStack01Icon,
  Shield01Icon,
  UserGroupIcon,
  WorkflowSquare01Icon,
  CpuIcon,
} from 'hugeicons-react'
import { AUTH_RATE_LIMIT } from '@/lib/api/rate-limit-policy'
import { organizationRoles } from '@/lib/auth/permissions'
import { cn } from '@/lib/utils'
import {
  ControlGrid,
  FaqBlock,
  HeroStage,
  LinkCards,
  MarketingShell,
  PageHero,
  PullQuote,
  RowTable,
  TileGrid,
} from '../blocks'
import { MONO, MUTED, Section, SectionIntro, Window } from '../primitives'

const AUDIT_ROWS = [
  ['10:42:07', 'maria@acme.com', 'product.campaign_post_status_changed', 'approve · 7 posts'],
  ['10:41:55', 'api key · ci', 'release.created', 'Recurring invoices'],
  ['10:39:12', 'jon@acme.com', 'member.role_updated', 'creator → approver'],
  ['10:37:40', 'system', 'post.published', 'receipt stored'],
] as const

const AUTH_PATH = [
  'Authenticate',
  'Active organization',
  'Membership',
  'Role',
  'Permission',
  'Workspace operational',
  'Tenant context',
  'Mutation',
  'Audit, same transaction',
]

const PROVIDERS = [
  ['DigitalOcean App Platform', 'Application hosting, in the New York region'],
  ['PlanetScale', 'Managed PostgreSQL'],
  ['Upstash', 'Redis for rate limits and caching'],
  ['Cloudflare R2', 'Private object storage for assets'],
  ['Cloudflare Browser Rendering', 'Headless rendering of designs'],
  ['Temporal Cloud', 'Durable workflows for publishing and maintenance, in AWS US East'],
  ['Resend', 'Account, invitation, and release email'],
  ['OpenRouter', 'Model routing for AI features'],
  ['Microlink', 'Screenshot capture API'],
  ['PostHog', 'Product analytics'],
] as const

function AuditWindow() {
  return (
    <Window className="w-full max-w-[900px]" meta="append-only · example" title="Audit log">
      <div className="overflow-x-auto">
        <table className={cn(MONO, 'w-full min-w-[640px] text-left text-[12px]')}>
          <tbody className="divide-y divide-white/[0.06]">
            {AUDIT_ROWS.map(([time, actor, action, detail]) => (
              <tr key={time}>
                <td className="px-4 py-3 text-white/45">{time}</td>
                <td className="px-4 py-3 text-white/80">{actor}</td>
                <td className="px-4 py-3 text-white">{action}</td>
                <td className="px-4 py-3 text-white/55">{detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Window>
  )
}

/** /security: access, authorization, data, audit, AI, providers, and disclosure. */
export function SecurityPage() {
  return (
    <MarketingShell finale={{ lead: 'Every control,', trail: 'written down.' }}>
      <PageHero
        body="Screenshot Studio is built for the security review. One authorization path for every request, an audit log the application cannot edit, private storage scoped to your organization, and AI that treats the internet as untrusted."
        eyebrow={{ label: 'Security' }}
        lead="Every control,"
        location="security_hero"
        primary={{ href: '/contact', label: 'Request a security review' }}
        secondary={{ href: '/enterprise', label: 'Enterprise' }}
        trail="written down."
      >
        <HeroStage variant={2}>
          <AuditWindow />
        </HeroStage>
      </PageHero>

      <Section>
        <SectionIntro
          body="Sign-in, roles, and identity are built on Better Auth organizations. Each organization is a tenant."
          label="Access"
          lead="Who gets in,"
          trail="and what they can do."
        />
        <div className="mt-24">
          <ControlGrid
            items={[
              {
                icon: Key01Icon,
                title: 'Single sign-on',
                body: 'SAML and OIDC, plus Google, Microsoft, and GitHub sign-in. Password sign-in can be switched off.',
              },
              {
                icon: UserGroupIcon,
                title: 'SCIM provisioning',
                body: 'SCIM tokens are scoped to one organization and stored as hashes. Deprovisioned people lose access.',
              },
              {
                icon: FingerPrintIcon,
                title: 'Two-factor',
                body: 'TOTP. A fresh two-factor session is required to configure SSO or SCIM and to connect social channels.',
              },
              {
                icon: Shield01Icon,
                title: `${organizationRoles.length} fixed roles`,
                body: `${organizationRoles.join(', ')}. Approving and publishing are separate permissions.`,
              },
              {
                icon: LockIcon,
                title: 'Sign-in limits',
                body: `Sign-in attempts are limited to ${AUTH_RATE_LIMIT.maxRequests} a minute.`,
              },
              {
                icon: Database01Icon,
                title: 'Scoped API keys',
                body: 'Five scopes, hashed at rest, shown once, and revoked on the next request. No key can approve or publish.',
              },
            ]}
          />
        </div>
      </Section>

      <Section>
        <SectionIntro
          body="Every request takes the same path, in the same order, and ends with an audit entry written in the same transaction as the change."
          label="Authorization"
          lead="One path."
          trail="Nine steps. No shortcuts."
        />
        <ol className="mt-24 grid gap-px overflow-hidden border border-[#212121] bg-[#212121] sm:grid-cols-3 lg:grid-cols-9">
          {AUTH_PATH.map((step, index) => (
            <li className="bg-[#090909] p-5" key={step}>
              <span className={cn(MONO, 'text-[12px]', MUTED)}>{index + 1}</span>
              <p className="mt-6 text-[14px] leading-[1.4] text-white">{step}</p>
            </li>
          ))}
        </ol>
        <div className="mt-4">
          <PullQuote
            quote="Client permissions control presentation; server permissions control security."
            source="Playbook Core"
          />
        </div>
      </Section>

      <Section>
        <SectionIntro
          body="Tenancy comes from the signed-in principal, never from the request. An ID from another organization returns 404, so IDs cannot be enumerated across tenants."
          label="Your data"
          lead="Yours,"
          trail="and nobody else's."
        />
        <div className="mt-24">
          <TileGrid
            items={[
              {
                snippet: 'org/<organizationId>/…',
                title: 'Private storage',
                body: 'Files live in a private bucket with no public domain, under a path the backend refuses to cross between organizations.',
              },
              {
                snippet: 'signed URL · 2 min',
                title: 'Short-lived links',
                body: 'Uploads and downloads use signed URLs that expire in two minutes. Uploads are write-once, and a replay is refused.',
              },
              {
                snippet: 'two-tenant test',
                title: 'Isolation, tested',
                body: 'An automated test with two organizations proves sessions and API keys cannot reach the other organization’s releases or assets.',
              },
              {
                snippet: 'web → backend SDK',
                title: 'No database in the web app',
                body: 'The web application has no database connection and no storage credentials. A test enforces it.',
              },
              {
                snippet: 'grace period · tombstone',
                title: 'Deliberate deletion',
                body: 'Deleting a workspace starts a grace period. Afterward an organization tombstone and the audit evidence remain.',
              },
              {
                snippet: 'United States',
                title: 'Where it runs',
                body: 'The application runs in the United States, in DigitalOcean’s New York region, with workflows in AWS US East. Regional data residency is not offered today.',
              },
            ]}
          />
        </div>
      </Section>

      <Section>
        <SectionIntro
          body="The audit log is append-only by database permission, not by convention. The application role can insert and read audit rows and nothing else."
          label="Audit"
          lead="A record nobody"
          trail="can quietly change."
        />
        <div className="mt-24">
          <ControlGrid
            items={[
              {
                icon: Database01Icon,
                title: 'Append-only',
                body: 'Redacted, per-organization entries, searchable by time, action, actor, outcome, entity, and text.',
              },
              {
                icon: FingerPrintIcon,
                title: 'Hashed IPs',
                body: 'IP addresses are stored as keyed hashes, not raw values.',
              },
              {
                icon: Shield01Icon,
                title: 'Retention and legal hold',
                body: 'Ninety days by default. Enterprise sets a longer period or places history on legal hold.',
              },
              {
                icon: WorkflowSquare01Icon,
                title: 'SIEM drains',
                body: 'CloudEvents JSON to any HTTPS endpoint with an HMAC SHA-256 signature, or presets for Splunk and Datadog.',
              },
              {
                icon: LockIcon,
                title: 'Encrypted drain secrets',
                body: 'Drain credentials are encrypted at rest with AES-256-GCM and never shown back.',
              },
              {
                icon: ServerStack01Icon,
                title: 'Delivery that retries',
                body: 'Drains deliver every minute, reject private addresses and redirects, and retry without blocking your work.',
              },
            ]}
          />
        </div>
      </Section>

      <Section>
        <SectionIntro
          body="AI features read untrusted text and are treated as untrusted themselves. They run inside one workspace, hold no credentials, and cannot approve anything."
          label="AI"
          lead="Untrusted in,"
          trail="audited out."
        />
        <div className="mt-24">
          <TileGrid
            items={[
              {
                icon: CpuIcon,
                title: 'No training on your content',
                body: 'Your history is retrieved at generation time for your workspace only. No model is trained on it.',
              },
              {
                icon: Shield01Icon,
                title: 'Injection defense',
                body: (
                  <>
                    Sources are sanitized, fenced, and flagged.{' '}
                    <Link
                      className="text-white underline-offset-4 hover:underline"
                      href="/product/guardrails"
                    >
                      Read the guardrails
                    </Link>
                    .
                  </>
                ),
              },
              {
                icon: Database01Icon,
                title: 'Metadata, not prompts',
                body: 'AI actions are audited with the model and usage. Prompt and completion text are kept out of the audit log.',
              },
            ]}
          />
        </div>
      </Section>

      <Section>
        <SectionIntro
          body="The services the hosted platform runs on, and what each one does. Self-hosting replaces any of them with your own."
          label="Providers"
          lead="What we run on."
          trail="And why."
        />
        <div className="mt-24">
          <RowTable
            caption="Infrastructure providers"
            head={['Provider', 'Purpose']}
            rows={PROVIDERS.map(([name, purpose]) => ({
              label: name,
              cells: [purpose],
            }))}
          />
        </div>
      </Section>

      <FaqBlock
        items={[
          {
            q: 'Do you have SOC 2 or ISO 27001?',
            a: 'Not today. The architecture, controls, and their tests are documented in the open-source repository, and we will walk your team through them.',
          },
          {
            q: 'How do I report a vulnerability?',
            a: (
              <>
                Contact us through the{' '}
                <Link className="text-white underline-offset-4 hover:underline" href="/contact">
                  contact page
                </Link>{' '}
                with the details. Please do not open a public issue for security reports.
              </>
            ),
          },
          {
            q: 'Can we run it in our own cloud?',
            a: 'Yes. Docker images and a Helm chart ship in the repository, so the whole platform can run on your infrastructure.',
          },
          {
            q: 'Who can see our workspace?',
            a: 'Only your members, through the roles you assign. Every read and write is scoped to your organization.',
          },
        ]}
      />

      <Section>
        <SectionIntro label="Related" lead="Keep reading." trail="Every part connects." />
        <div className="mt-24">
          <LinkCards paths={['/enterprise', '/product/guardrails', '/product/approvals']} />
        </div>
      </Section>
    </MarketingShell>
  )
}
