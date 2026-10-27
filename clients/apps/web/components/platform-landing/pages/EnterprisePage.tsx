import { DatabaseIcon as Database01Icon } from '@phosphor-icons/react/dist/ssr/Database'
import { FingerprintIcon as FingerPrintIcon } from '@phosphor-icons/react/dist/ssr/Fingerprint'
import { KeyIcon as Key01Icon } from '@phosphor-icons/react/dist/ssr/Key'
import { HardDrivesIcon as ServerStack01Icon } from '@phosphor-icons/react/dist/ssr/HardDrives'
import { ShieldIcon as Shield01Icon } from '@phosphor-icons/react/dist/ssr/Shield'
import { UsersIcon as UserGroupIcon } from '@phosphor-icons/react/dist/ssr/Users'
import { hasWorkspaceFeature } from '@/lib/billing/plans'
import { cn } from '@/lib/utils'
import {
  ControlGrid,
  FaqBlock,
  HeroStage,
  LinkCards,
  MarketingShell,
  PageHero,
  SplitFeature,
  StatRows,
  TileGrid,
} from '../blocks'
import { formatQuota } from '../pricing'
import { CONTAINER, MONO, MUTED, Section, SectionIntro, Window } from '../primitives'

function DrainWindow() {
  return (
    <Window className="w-full max-w-[560px]" meta="Enterprise" title="Audit log export">
      <dl className="divide-y divide-white/[0.06] text-[13px]">
        {[
          ['Destination', 'Splunk HEC'],
          ['Format', 'CloudEvents JSON'],
          ['Credential', 'HEC token · encrypted'],
          ['Private addresses', 'Refused'],
          ['Schedule', 'Every minute, with retries'],
        ].map(([label, value]) => (
          <div className="flex items-center justify-between gap-4 px-4 py-3" key={label}>
            <dt className="text-[#858585]">{label}</dt>
            <dd className={cn(MONO, 'text-[12px] text-white/85')}>{value}</dd>
          </div>
        ))}
      </dl>
      <div className={cn(MONO, 'flex items-center gap-2 px-4 py-3 text-[11.5px] text-emerald-300')}>
        <span className="size-1.5 rounded-full bg-emerald-400" />
        delivering
      </div>
    </Window>
  )
}

function SsoWindow() {
  return (
    <Window meta="owner · fresh 2FA" title="Single sign-on">
      <dl className="divide-y divide-white/[0.06] text-[13px]">
        {[
          ['Protocol', 'SAML or OIDC'],
          ['Provisioning', 'SCIM'],
          ['Default role', 'viewer'],
          ['Password sign-in', 'Off'],
        ].map(([label, value]) => (
          <div className="flex items-center justify-between gap-4 px-4 py-3" key={label}>
            <dt className="text-[#858585]">{label}</dt>
            <dd className={cn(MONO, 'text-[12px] text-white/85')}>{value}</dd>
          </div>
        ))}
      </dl>
    </Window>
  )
}

/** /enterprise: identity, audit drains, retention, quotas, and self-hosting. */
export function EnterprisePage() {
  const included = [
    hasWorkspaceFeature('enterprise', 'enterprise:sso') && 'SSO',
    hasWorkspaceFeature('enterprise', 'enterprise:scim') && 'SCIM',
    hasWorkspaceFeature('enterprise', 'enterprise:audit-drain') && 'audit log export',
  ].filter(Boolean)
  return (
    <MarketingShell finale={{ lead: 'Talk to sales', trail: 'about SSO, SCIM, and self-hosting.' }}>
      <PageHero
        body={`Enterprise adds ${included.join(', ')}, longer audit retention, legal hold, and the highest limits on every quota. You can also run the whole platform in your own cloud.`}
        eyebrow={{ label: 'Enterprise' }}
        lead="Run launches inside your company's controls,"
        location="enterprise_hero"
        primary={{ href: '/contact', label: 'Contact sales' }}
        secondary={{ href: '/security', label: 'Security overview' }}
        trail="with your identity provider and your retention rules."
      >
        <HeroStage variant={3}>
          <DrainWindow />
        </HeroStage>
      </PageHero>

      <Section>
        <SectionIntro
          body="Your identity provider decides who gets in. Your security log tool (SIEM) receives every audit event. Your retention policy decides how long history stays."
          label="Controls"
          lead="The controls your IT team will ask about,"
          trail="included on Enterprise."
        />
        <div className="mt-24">
          <ControlGrid
            items={[
              {
                icon: Key01Icon,
                title: 'SAML and OIDC',
                body: 'Single sign-on through your identity provider, including Microsoft Entra ID.',
              },
              {
                icon: UserGroupIcon,
                title: 'SCIM',
                body: 'SCIM user provisioning adds and removes teammates automatically. Tokens are scoped to one workspace and hashed.',
              },
              {
                icon: FingerPrintIcon,
                title: 'Fresh two-factor to change it',
                body: 'Configuring SSO or SCIM requires an owner or admin with a fresh two-factor session.',
              },
              {
                icon: Database01Icon,
                title: 'Audit log export',
                body: 'Signed CloudEvents to any HTTPS endpoint, or presets for Splunk HEC and Datadog.',
              },
              {
                icon: Shield01Icon,
                title: 'Retention and legal hold',
                body: 'Set a longer retention period, or hold history indefinitely. The daily retention job honors holds.',
              },
              {
                icon: ServerStack01Icon,
                title: 'Self-hosting',
                body: 'Production Docker images and a portable Helm chart, in the open-source repository.',
              },
            ]}
          />
        </div>
      </Section>

      <Section>
        <SectionIntro
          body="Identity setup is a privileged action, so it asks for proof. Teammates who arrive through SSO or SCIM start with read-only access."
          label="Identity"
          lead="New teammates start as viewers"
          trail="until someone grants them more."
        />
        <div className="mt-24 space-y-24">
          <SplitFeature
            body="Connect a SAML or OIDC provider, turn on SCIM, and switch off password sign-in. Changes need an owner or admin with a fresh two-factor session."
            bullets={[
              'Google, Microsoft, and GitHub sign-in also available',
              'SCIM deactivation removes access',
              'Six fixed roles, assigned per workspace',
            ]}
            index={0}
            title="Your directory, your rules"
          >
            <SsoWindow />
          </SplitFeature>
          <SplitFeature
            body="Every audit event is sent to your security log tool as it happens. Export secrets are encrypted at rest with AES-256-GCM and never shown back. Private addresses and redirects are refused."
            index={1}
            link={{ href: '/security', label: 'Read the security overview' }}
            title="Every audit event in your SIEM"
          >
            <DrainWindow />
          </SplitFeature>
        </div>
      </Section>

      <section className={cn(CONTAINER, 'pb-24 sm:pb-32')}>
        <div className="grid gap-12 border-t border-[#212121] pt-24 sm:pt-32 lg:grid-cols-2 lg:gap-24">
          <p className="text-balance text-[24px] leading-[1.3] tracking-[-0.015em] text-white sm:text-[30px]">
            Room for every product line.{' '}
            <span className={MUTED}>
              Enterprise limits, read from the same code that enforces them.
            </span>
          </p>
          <StatRows
            stats={[
              {
                value: formatQuota('enterprise', 'ai:credits:monthly'),
                label: 'AI credits a month',
              },
              {
                value: formatQuota('enterprise', 'api:write:minute'),
                label: 'API writes a minute',
              },
              { value: formatQuota('enterprise', 'jobs:concurrent'), label: 'concurrent jobs' },
              { value: formatQuota('enterprise', 'storage:bytes'), label: 'asset storage' },
            ]}
          />
        </div>
      </section>

      <Section>
        <SectionIntro
          body="The code is open source either way."
          label="Deployment"
          lead="Use our hosted platform"
          trail="or run it in your own cloud."
        />
        <div className="mt-24">
          <TileGrid
            columns={2}
            items={[
              {
                snippet: 'hosted · United States',
                title: 'Hosted',
                body: 'We run it on DigitalOcean in New York, with scheduled workflows on Temporal Cloud and private storage on Cloudflare R2.',
              },
              {
                snippet: 'helm install',
                title: 'Self-hosted',
                body: 'A portable Helm chart and production Docker images. Bring your own PostgreSQL, Redis, object storage, and Temporal.',
              },
            ]}
          />
        </div>
      </Section>

      <FaqBlock
        items={[
          {
            q: 'Do you sign a DPA or security questionnaire?',
            a: 'Talk to us. We will share the architecture and control documentation and work through your questionnaire with you.',
          },
          {
            q: 'Do you have SOC 2?',
            a: 'Not today. Every control on our security page is documented and tested in the open-source repository.',
          },
          {
            q: 'Can we keep data outside the United States?',
            a: 'The hosted platform runs in the United States. To keep data elsewhere, self-host it in your own region.',
          },
          {
            q: 'How is Enterprise priced?',
            a: 'From $3,000 a month, billed annually, sized to your launches, seats, and products. Contact sales.',
          },
        ]}
      />

      <Section>
        <SectionIntro
          label="Related"
          lead="Read the full security overview,"
          trail="compare plan prices, or see how approvals work."
        />
        <div className="mt-24">
          <LinkCards paths={['/security', '/pricing', '/product/approvals']} />
        </div>
      </Section>
    </MarketingShell>
  )
}
