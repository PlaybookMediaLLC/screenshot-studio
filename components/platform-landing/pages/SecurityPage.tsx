import Link from 'next/link'
import { PiDatabase as Database01Icon, PiFingerprint as FingerPrintIcon, PiKey as Key01Icon, PiLock as LockIcon, PiHardDrives as ServerStack01Icon, PiShield as Shield01Icon, PiUsers as UserGroupIcon, PiFlowArrow as WorkflowSquare01Icon, PiCpu as CpuIcon } from 'react-icons/pi'
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
import { AuthPath } from '../diagrams/AuthPath'
import { MONO, Section, SectionIntro, Window } from '../primitives'
import { Table, TableBody, TableRow, TableCell } from '@/components/ui/table'

const AUDIT_ROWS = [
  ['10:42:07', 'maria@acme.com', 'product.campaign_post_status_changed', 'approve · 6 posts'],
  ['10:41:55', 'api key · ci', 'release.created', 'Recurring invoices'],
  ['10:39:12', 'jon@acme.com', 'member.role_updated', 'creator → approver'],
  ['10:37:40', 'system', 'post.published', 'confirmation stored'],
] as const

const PROVIDERS = [
  ['DigitalOcean App Platform', 'Application hosting, in the New York region'],
  ['PlanetScale', 'Managed PostgreSQL'],
  ['Upstash', 'Redis for rate limits and caching'],
  ['Cloudflare R2', 'Private object storage for assets'],
  ['Cloudflare Browser Rendering', 'Headless rendering of visuals'],
  [
    'Temporal Cloud',
    'Workflows that survive restarts, for publishing and maintenance, in AWS US East',
  ],
  ['Resend', 'Account, invitation, and release email'],
  ['OpenRouter', 'Model routing for AI features'],
  ['Microlink', 'Screenshot capture API'],
  ['PostHog', 'Product analytics'],
] as const

function AuditWindow() {
  return (
    <Window className="w-full max-w-[900px]" meta="append-only · example" title="Audit log">
      <div className="overflow-x-auto">
        <Table className={cn(MONO, 'w-full min-w-[640px] text-left text-[12px]')}>
          <TableBody className="divide-y divide-white/[0.06]">
            {AUDIT_ROWS.map(([time, actor, action, detail]) => (
              <TableRow key={time}>
                <TableCell className="whitespace-normal px-4 py-3 text-white/45">{time}</TableCell>
                <TableCell className="whitespace-normal px-4 py-3 text-white/80">{actor}</TableCell>
                <TableCell className="whitespace-normal px-4 py-3 text-white">{action}</TableCell>
                <TableCell className="whitespace-normal px-4 py-3 text-white/55">{detail}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Window>
  )
}

/** /security: access, authorization, data, audit, AI, providers, and disclosure. */
export function SecurityPage() {
  return (
    <MarketingShell
      finale={{
        lead: 'Request a security review',
        trail: 'and walk through the controls with us.',
      }}
    >
      <PageHero
        body="Every request goes through the same permission checks. The app can't edit the audit log, and your files sit in private storage for your workspace alone. The AI treats the internet as untrusted."
        eyebrow={{ label: 'Security' }}
        lead="Answers for your security review,"
        location="security_hero"
        primary={{ href: '/contact', label: 'Request a security review' }}
        secondary={{ href: '/enterprise', label: 'Enterprise' }}
        trail="backed by code you can read."
      >
        <HeroStage variant={2}>
          <AuditWindow />
        </HeroStage>
      </PageHero>

      <Section>
        <SectionIntro
          body="Sign-in, roles, and identity are built on Better Auth. Each workspace is its own Better Auth organization."
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
                body: 'SCIM user provisioning. Tokens are scoped to one workspace and stored as hashes. Deprovisioned people lose access.',
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
          body="Each request ends with an audit entry saved together with the change."
          label="Authorization"
          lead="Every request takes the same nine steps"
          trail="in the same order."
        />
        <div className="mt-24">
          <AuthPath />
        </div>
        <div className="mt-4">
          <PullQuote quote="The browser only decides which buttons to show. The server decides what you can do." />
        </div>
      </Section>

      <Section>
        <SectionIntro
          body="Your login decides which workspace you see. An ID from another workspace returns 404, so nobody can probe for other workspaces' IDs."
          label="Your data"
          lead="Your data stays in your workspace,"
          trail="and requests from other workspaces get a 404."
        />
        <div className="mt-24">
          <TileGrid
            items={[
              {
                snippet: 'org/<organizationId>/…',
                title: 'Private storage',
                body: "Files live in a private bucket with no public domain, under a path the backend won't cross between workspaces.",
              },
              {
                snippet: 'signed URL · 2 min',
                title: 'Short-lived links',
                body: 'Uploads and downloads use signed URLs that expire in two minutes. Uploads are write-once, and a replay is refused.',
              },
              {
                snippet: 'two-workspace test',
                title: 'Isolation, tested',
                body: "An automated test with two workspaces proves logins and API keys can't reach the other workspace's releases or assets.",
              },
              {
                snippet: 'web → backend SDK',
                title: 'No database in the web app',
                body: 'The web application has no database connection and no storage credentials. A test enforces it.',
              },
              {
                snippet: 'grace period · tombstone',
                title: 'Deliberate deletion',
                body: 'Deleting a workspace starts a grace period. Afterward, a deletion record and the audit evidence remain.',
              },
              {
                snippet: 'United States',
                title: 'Where it runs',
                body: "The application runs in the United States, in DigitalOcean's New York region, with workflows in AWS US East. Regional data residency is not offered today.",
              },
            ]}
          />
        </div>
      </Section>

      <Section>
        <SectionIntro
          body="The application's database role can insert and read audit rows and nothing else."
          label="Audit"
          lead="An audit log the app can only add to,"
          trail="enforced by database permissions."
        />
        <div className="mt-24">
          <ControlGrid
            items={[
              {
                icon: Database01Icon,
                title: 'Append-only',
                body: 'Redacted entries for each workspace, searchable by time, action, teammate, outcome, record, and text.',
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
                title: 'Audit log export',
                body: 'Send events to your security log tool (SIEM) as CloudEvents JSON over HTTPS with an HMAC SHA-256 signature, or use the Splunk and Datadog presets.',
              },
              {
                icon: LockIcon,
                title: 'Encrypted export secrets',
                body: 'Export credentials are encrypted at rest with AES-256-GCM and never shown back.',
              },
              {
                icon: ServerStack01Icon,
                title: 'Delivery that retries',
                body: 'Exports run every minute, refuse private addresses and redirects, and retry without blocking your work.',
              },
            ]}
          />
        </div>
      </Section>

      <Section>
        <SectionIntro
          body="The AI reads untrusted text, so Shots doesn't trust the AI either. It runs inside one workspace, holds no credentials, and can't approve anything."
          label="AI"
          lead="The AI is treated as untrusted,"
          trail="and every action it takes is logged."
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
                    Sources are cleaned, labeled as untrusted, and flagged.{' '}
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
                title: 'Usage logged, prompts left out',
                body: 'AI actions are audited with the model and usage. Prompt and completion text are kept out of the audit log.',
              },
            ]}
          />
        </div>
      </Section>

      <Section>
        <SectionIntro
          label="Providers"
          lead="The services the hosted platform runs on"
          trail="and what each one does."
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
            q: 'Who can see our workspace?',
            a: 'Only your teammates, through the roles you assign. Every read and write is scoped to your workspace.',
          },
        ]}
      />

      <Section>
        <SectionIntro
          label="Related"
          lead="See what Enterprise adds,"
          trail="how the AI is guarded, and how approval works."
        />
        <div className="mt-24">
          <LinkCards paths={['/enterprise', '/product/guardrails', '/product/approvals']} />
        </div>
      </Section>
    </MarketingShell>
  )
}
