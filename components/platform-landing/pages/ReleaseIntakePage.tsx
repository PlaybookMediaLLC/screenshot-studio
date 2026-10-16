import { CommandLineIcon, Edit02Icon, WebhookIcon } from 'hugeicons-react'
import { apiErrorBody } from '@/lib/api/errors'
import { apiKeyScopes, type ApiKeyScope } from '@/lib/auth/api-key-scopes'
import { workspacePlanSchema } from '@/lib/billing/plans'
import { cn } from '@/lib/utils'
import { CodeTabs } from '../CodeTabs'
import { FaqBlock, LinkCards, MarketingShell, PageHero, RowTable, TileGrid } from '../blocks'
import { MONO, MUTED, Section, SectionIntro, Stage, Window } from '../primitives'
import { formatQuota } from '../pricing'

const SCOPE_NOTES: Record<ApiKeyScope, string> = {
  'release:create': 'Create releases, the input to every launch.',
  'source:write': 'Register source apps that send signed webhooks.',
  'asset:write': 'Create and complete workspace assets.',
  'upload:sign': 'Request signed upload URLs for asset bytes.',
  'artifact:read': 'Read releases, assets, and generated artifacts.',
}

/** Field limits match releaseCreateSchema in lib/tenant/schemas.ts. */
const FIELDS = [
  ['title', 'Required. Up to 160 characters.'],
  [
    'benefitStatement',
    'Why it matters, up to 500 characters. Optional when a source link is given.',
  ],
  ['description', 'What changed, in plain text. Up to 10,000 characters.'],
  ['audience', 'Who should hear about it. Up to 1,000 characters.'],
  ['sourceUrls', 'Up to 20 public http(s) links: the pull request, changelog, and docs.'],
  ['productSurfaceId', 'Optional. The product screen this release changes.'],
] as const

const ENDPOINTS = [
  ['POST', '/api/v1/releases', 'release:create', 'Create a release. Accepts Idempotency-Key.'],
  ['GET', '/api/v1/releases', 'artifact:read', 'List workspace releases.'],
  ['POST', '/api/v1/source-apps', 'source:write', 'Register a source app for webhooks.'],
  [
    'POST',
    '/api/v1/assets/upload-url',
    'upload:sign',
    'Reserve an asset and get a write-once upload URL.',
  ],
  ['POST', '/api/v1/assets/{assetId}/complete', 'asset:write', 'Mark an upload complete.'],
  [
    'GET',
    '/api/v1/assets/{assetId}/download-url',
    'artifact:read',
    'Get a short-lived download URL.',
  ],
  [
    'DELETE',
    '/api/v1/assets/{assetId}',
    'asset:write',
    'Queue deletion of an unused asset. Pro and up.',
  ],
] as const

const WEBHOOKS = [
  ['GitHub', 'X-Hub-Signature-256', 'X-GitHub-Delivery'],
  ['GitLab', 'webhook-signature', 'webhook-timestamp'],
  ['Any pipeline', 'X-Shots-Signature', 'X-Shots-Timestamp, -Event-Id'],
] as const

/** A real error body, built by the same function every route uses. */
const ERROR_EXAMPLE = JSON.stringify(
  apiErrorBody(
    429,
    'workspace_quota_exceeded',
    'This workspace has used its monthly AI credits.',
    'Wait for the next cycle or move to a larger plan.'
  ),
  null,
  2
)

/** /product/release-intake: the form, the REST API, signed webhooks, keys, and conventions. */
export function ReleaseIntakePage() {
  return (
    <MarketingShell finale={{ lead: 'Releases in.', trail: 'Launches out.' }}>
      <PageHero
        body="Type a release into the form, send it from CI with an API key, or let GitHub, GitLab, or your own pipeline deliver it through a signed webhook. Every path lands in the same release, ready for launch intelligence."
        eyebrow={{ href: '/product', label: 'Release intake', parent: 'Product' }}
        lead="Releases in."
        location="release_intake_hero"
        primary={{ href: '/api-reference', label: 'API reference' }}
        secondary={{ href: '/sign-up', label: 'Get an API key' }}
        trail="From anywhere you ship."
      >
        <Stage className="px-4 py-12 sm:px-12 sm:py-20" variant={3}>
          <div className="w-full min-w-0 max-w-[760px]">
            <CodeTabs />
          </div>
        </Stage>
      </PageHero>

      <Section>
        <SectionIntro
          body="Pick the path that fits how you ship. All three create the same release object, scoped to your workspace."
          label="Three ways in"
          lead="A form, an API,"
          trail="or a webhook."
        />
        <div className="mt-24">
          <TileGrid
            items={[
              {
                icon: Edit02Icon,
                title: 'The release form',
                body: 'Name the release, say why it matters, and paste the links. Best when a person is writing the brief.',
              },
              {
                icon: CommandLineIcon,
                title: 'The REST API',
                body: 'POST /api/v1/releases with an organization API key from CI or a deploy script. Retries are safe with an idempotency key.',
              },
              {
                icon: WebhookIcon,
                title: 'Signed webhooks',
                body: 'Point a GitHub or GitLab release webhook at your source app, or sign your own. GitHub and GitLab releases link their release page as a source.',
              },
            ]}
          />
        </div>
      </Section>

      <Section>
        <SectionIntro
          body="A release is a brief, not a campaign. Editing it later never rewrites the campaigns built from it."
          label="The release"
          lead="Six fields."
          trail="Two are enough."
        />
        <div className="mt-24">
          <RowTable
            caption="Release fields"
            head={['Field', 'Rule']}
            monoLabels
            rows={FIELDS.map(([field, rule]) => ({ label: field, cells: [rule] }))}
          />
        </div>
      </Section>

      <Section>
        <SectionIntro
          body="Signatures are checked over the exact body bytes before anything is parsed. Redeliveries are deduplicated, so a retried webhook creates one release."
          label="Webhooks"
          lead="Signed or refused."
          trail="Deduplicated by default."
        />
        <div className="mt-24">
          <RowTable
            caption="Webhook signatures"
            head={['Sender', 'Signature', 'Replay protection']}
            rows={WEBHOOKS.map(([sender, signature, replay]) => ({
              label: sender,
              cells: [signature, replay].map((value) => (
                <span className={cn(MONO, 'text-[13px] text-white/85')} key={value}>
                  {value}
                </span>
              )),
            }))}
          />
        </div>
        <p className={cn('mt-8 max-w-[760px] text-[15px] leading-[1.6]', MUTED)}>
          A release that arrives by webhook or API key has no author on your team, so launch
          intelligence fences its brief as untrusted and shows it to the reviewer with the sources.
        </p>
      </Section>

      <Section>
        <SectionIntro
          body={`Organization API keys carry one of ${apiKeyScopes.length} scopes. They are hashed at rest, shown once, and revoked on the next request. No key can manage members, SSO, SCIM, audit drains, retention, or publishing, and no key can approve.`}
          label="API keys"
          lead="Narrow keys."
          trail="Nothing to approve with."
        />
        <div className="mt-24 grid gap-16 lg:grid-cols-[1fr_1.2fr]">
          <RowTable
            caption="API key scopes"
            head={['Scope', 'Allows']}
            monoLabels
            rows={apiKeyScopes.map((scope) => ({ label: scope, cells: [SCOPE_NOTES[scope]] }))}
          />
          <RowTable
            caption="REST endpoints"
            head={['Endpoint', 'Scope', 'Does']}
            monoLabels
            rows={ENDPOINTS.map(([method, path, scope, does]) => ({
              label: (
                <>
                  <span className="text-white/50">{method}</span> {path}
                </>
              ),
              cells: [
                <span className={cn(MONO, 'text-[12px]')} key="scope">
                  {scope}
                </span>,
                does,
              ],
            }))}
          />
        </div>
      </Section>

      <Section>
        <SectionIntro
          body="The public spec is generated from the same Zod contracts the routes validate with, and tests keep the two from drifting."
          label="Conventions"
          lead="Predictable by design."
          trail="Boring on purpose."
        />
        <div className="mt-24 grid gap-4 lg:grid-cols-2">
          <TileGrid
            columns={2}
            items={[
              {
                snippet: 'Idempotency-Key',
                title: 'Safe retries',
                body: 'Up to 128 characters. Longer keys are rejected, never truncated. A replay returns 200 with the first result.',
              },
              {
                snippet: 'X-Request-Id',
                title: 'Traceable',
                body: 'Every response carries a request ID that also appears in the audit log.',
              },
              {
                snippet: '/openapi.json',
                title: 'OpenAPI 3.1',
                body: 'Also at /.well-known/openapi.json, with a live Scalar reference at /api-reference.',
              },
              {
                snippet: 'Accept: text/markdown',
                title: 'Agent friendly',
                body: 'llms.txt, llms-full.txt, and Markdown versions of supported pages.',
              },
            ]}
          />
          <Window className="min-w-0" meta="lib/api/errors.ts" title="One error envelope">
            <pre
              className={cn(
                MONO,
                'overflow-x-auto p-5 text-[12.5px] leading-[1.7] text-emerald-200/80'
              )}
            >
              {ERROR_EXAMPLE}
            </pre>
          </Window>
        </div>
      </Section>

      <Section>
        <SectionIntro
          body="API writes are limited per workspace by plan. Reads are not counted."
          label="Rate limits"
          lead="Writes per minute,"
          trail="by plan."
        />
        <div className="mt-24">
          <RowTable
            caption="API write limits"
            head={['Plan', 'API writes per minute', 'AI credits per month']}
            rows={workspacePlanSchema.options.map((plan) => ({
              label: plan[0].toUpperCase() + plan.slice(1),
              cells: [
                <span className={cn(MONO, 'text-[13px] text-white')} key="api">
                  {formatQuota(plan, 'api:write:minute')}
                </span>,
                <span className={cn(MONO, 'text-[13px] text-white')} key="gen">
                  {formatQuota(plan, 'ai:credits:monthly')}
                </span>,
              ],
            }))}
          />
        </div>
      </Section>

      <FaqBlock
        items={[
          {
            q: 'Is there an SDK?',
            a: 'Not yet. The API is plain REST with an OpenAPI 3.1 spec, so any generated client works.',
          },
          {
            q: 'Does the API send webhooks back to me?',
            a: 'Not yet. Outbound release and delivery events are planned. Today, poll the release list or watch the workspace.',
          },
          {
            q: 'Can the API create campaigns or approve posts?',
            a: 'Campaign endpoints are planned. Approving will never be possible from an API key.',
          },
          {
            q: 'Is there a GitHub App?',
            a: 'Not yet. Today a repository webhook pointed at your source app does the job. A GitHub App with merged-PR detection is planned.',
          },
        ]}
      />

      <Section>
        <SectionIntro label="Related" lead="Keep reading." trail="Every part connects." />
        <div className="mt-24">
          <LinkCards
            paths={['/integrations', '/product/launch-intelligence', '/solutions/developer-tools']}
          />
        </div>
      </Section>
    </MarketingShell>
  )
}
