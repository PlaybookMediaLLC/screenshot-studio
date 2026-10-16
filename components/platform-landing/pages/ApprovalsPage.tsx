import { hasPermission, organizationRoles, type Permission } from '@/lib/auth/permissions'
import {
  campaignPostTransitions,
  type CampaignApprovalDecision,
} from '@/lib/tenant/campaign-status'
import { cn } from '@/lib/utils'
import {
  AvailabilityPill,
  FaqBlock,
  HeroStage,
  LinkCards,
  MarketingShell,
  Mark,
  PageHero,
  PullQuote,
  RowTable,
  TileGrid,
} from '../blocks'
import { Check, MONO, MUTED, Section, SectionIntro, Window } from '../primitives'

const DECISION_LABELS: Record<CampaignApprovalDecision, string> = {
  submit: 'Submit for review',
  approve: 'Approve',
  reject: 'Reject',
  request_changes: 'Request changes',
}

const DECISIONS: CampaignApprovalDecision[] = ['submit', 'approve', 'reject', 'request_changes']

/** Permissions worth showing a buyer, in reading order. */
const PERMISSION_ROWS: { permission: Permission; label: string }[] = [
  { permission: 'artifact:read', label: 'Read campaigns and assets' },
  { permission: 'release:create', label: 'Create releases and submit posts' },
  { permission: 'artifact:edit', label: 'Edit drafts and designs' },
  { permission: 'release:approve', label: 'Approve, reject, request changes' },
  { permission: 'publish:manage', label: 'Schedule and cancel posts' },
  { permission: 'brand:manage', label: 'Manage brand and product' },
  { permission: 'member:invite', label: 'Invite members' },
  { permission: 'audit:read', label: 'Read the audit log' },
  { permission: 'identity:manage', label: 'Configure SSO and SCIM' },
  { permission: 'workspace:delete', label: 'Delete the workspace' },
]

const rolesWith = (permission: Permission) =>
  organizationRoles.filter((role) => hasPermission(role, permission)).join(', ')

const SCHEDULE_CHECKS = [
  'The post belongs to your workspace',
  'The post is approved',
  'A creative is attached',
  'The copy is within the length limit',
  'The destination channel is active and yours',
  'The creative itself is approved',
]

const AUDIT_EVENTS = [
  ['product.campaign_created', 'A campaign and its post count'],
  ['product.campaign_post_status_changed', 'A decision and how many posts it covered'],
  ['product.campaign_post_scheduled', 'The campaign and the scheduled post'],
  ['post.scheduled', 'The destination and the creative'],
  ['post.cancelled', 'Who cancelled it'],
  ['post.published', 'The provider post ID'],
  ['post.publish_recovery_required', 'The failure code, for a person to resolve'],
] as const

function State({ id, tone }: { id: string; tone?: 'good' | 'warn' }) {
  return (
    <span
      className={cn(
        MONO,
        'inline-flex h-9 shrink-0 items-center rounded-lg border px-3 text-[11.5px]',
        tone === 'good' && 'border-white bg-white text-black',
        tone === 'warn' && 'border-amber-300/60 bg-[#161616] text-white',
        !tone && 'border-white/20 bg-[#161616] text-white/90'
      )}
    >
      {id}
    </span>
  )
}

function Arrow({ label }: { label: string }) {
  return (
    <span className="flex min-w-[64px] flex-1 flex-col items-center gap-1 px-1">
      <span className={cn(MONO, 'whitespace-nowrap text-[10px] text-white/45')}>{label}</span>
      <span className="relative h-px w-full bg-white/35 after:absolute after:-right-px after:-top-[3px] after:border-y-[3.5px] after:border-l-[6px] after:border-y-transparent after:border-l-white/50" />
    </span>
  )
}

/** The campaign post state machine as a flow: the happy path, then the two review exits. */
function StateDiagram() {
  return (
    <Window
      className="w-full max-w-[1040px]"
      meta="lib/tenant/campaign-status.ts"
      title="Post states"
    >
      <div className="overflow-x-auto p-6">
        <div className="min-w-[860px] space-y-5">
          <div className="flex items-center">
            <State id="DRAFT" />
            <Arrow label="submit" />
            <State id="READY_FOR_REVIEW" />
            <Arrow label="approve" />
            <State id="APPROVED" tone="good" />
            <Arrow label="schedule" />
            <State id="SCHEDULED" />
            <Arrow label="worker + receipt" />
            <State id="PUBLISHED" tone="good" />
          </div>
          {[
            {
              label: 'request changes',
              id: 'NEEDS_CHANGES',
              note: 'edit, then submit again',
              tone: 'warn' as const,
            },
            { label: 'reject', id: 'REJECTED', note: 'final', tone: undefined },
          ].map((exit) => (
            <div className="flex items-center" key={exit.id}>
              <span className="invisible" aria-hidden="true">
                <State id="DRAFT" />
              </span>
              <span className="invisible flex min-w-[64px] flex-1" aria-hidden="true" />
              <span className={cn(MONO, 'w-[150px] shrink-0 pl-4 text-[10px] text-white/40')}>
                ↳ from review
              </span>
              <Arrow label={exit.label} />
              <span className="w-[130px] shrink-0">
                <State id={exit.id} tone={exit.tone} />
              </span>
              <span className={cn(MONO, 'ml-4 w-[180px] shrink-0 text-[11px] text-white/45')}>
                {exit.note}
              </span>
              <span className="flex-[2]" />
            </div>
          ))}
        </div>
      </div>
    </Window>
  )
}

/** /product/approvals: the state machine, roles, batch semantics, scheduling gate, and audit. */
export function ApprovalsPage() {
  return (
    <MarketingShell finale={{ lead: 'Agents draft.', trail: 'People decide.' }}>
      <PageHero
        body="Approval is a state machine on the server. The browser, the API, and every agent go through the same transitions. Machines can draft. Only signed-in members move posts to review, and only members with approval rights can approve."
        eyebrow={{ href: '/product', label: 'Approvals', parent: 'Product' }}
        lead="Nothing ships"
        location="approvals_hero"
        trail="until someone says so."
      >
        <HeroStage variant={2}>
          <StateDiagram />
        </HeroStage>
      </PageHero>

      <Section>
        <SectionIntro
          body="This table is generated from the transition map the server enforces. Every decision needs a signed-in member. A decision applied outside its starting states is refused, and there is no force transition or administrative override."
          label="Transitions"
          lead="One table."
          trail="Every caller."
        />
        <div className="mt-24">
          <RowTable
            caption="Approval transitions"
            head={['Decision', 'From', 'To', 'Roles allowed']}
            rows={DECISIONS.map((decision) => {
              const transition = campaignPostTransitions[decision]
              return {
                label: DECISION_LABELS[decision],
                cells: [
                  <span className={cn(MONO, 'text-[13px]')} key="from">
                    {transition.from.join(', ')}
                  </span>,
                  <span className={cn(MONO, 'text-[13px] text-white')} key="to">
                    {transition.to}
                  </span>,
                  rolesWith(transition.permission),
                ],
              }
            })}
          />
        </div>
      </Section>

      <div className="mx-auto w-full max-w-[1280px] px-6 sm:px-10">
        <PullQuote
          quote="Approval is the human gate the whole platform rests on."
          source="Campaign approval"
        />
      </div>

      <Section>
        <SectionIntro
          body="Six fixed roles. Approving and publishing are separate permissions, so an approver can sign off without publishing rights and a publisher can schedule without approval rights. A solo founder holds every role and can approve their own work."
          label="Roles"
          lead="Separate the decision"
          trail="from the delivery."
        />
        <div className="mt-24">
          <RowTable
            caption="Role permissions"
            head={['Permission', ...organizationRoles]}
            rows={PERMISSION_ROWS.map(({ label, permission }) => ({
              label,
              cells: organizationRoles.map((role) => (
                <Mark key={role} value={hasPermission(role, permission)} />
              )),
            }))}
          />
        </div>
      </Section>

      <Section>
        <SectionIntro
          body="Batch approval is the primary action, not an optimization. Approving seven posts is one click, one transaction, and one audit entry."
          label="Batch"
          lead="Approve all seven."
          trail="Or exactly three."
        />
        <div className="mt-24">
          <TileGrid
            columns={2}
            items={[
              {
                snippet: 'postIds: omitted',
                title: 'Every eligible post',
                body: 'Leave the list out and the decision applies to every post in the campaign that can take it. That is the Approve all button.',
              },
              {
                snippet: 'postIds: [a, b, c]',
                title: 'Exactly these posts',
                body: 'Name the posts and the call is all or nothing. If one is not eligible, nothing changes and the call returns 409.',
              },
              {
                snippet: '409 · nothing eligible',
                title: 'No silent success',
                body: 'A double-clicked Approve reports a clear conflict instead of pretending a second approval happened.',
              },
              {
                snippet: 'one winner, one 409',
                title: 'Concurrent reviewers',
                body: 'Two approvers acting at once produce one success and one conflict. No row is locked while someone thinks.',
              },
            ]}
          />
        </div>
      </Section>

      <Section>
        <SectionIntro
          body="Approval and scheduling are separate gates. Scheduling checks the post again, and the delivery worker checks the creative a third time just before it calls the network."
          label="Scheduling"
          lead="Approved is not enough."
          trail="Six checks to schedule."
        />
        <div className="mt-24 grid gap-4 lg:grid-cols-2">
          <ul className="space-y-px bg-[#111] p-2">
            {SCHEDULE_CHECKS.map((check, index) => (
              <li className="flex items-center gap-4 px-4 py-4" key={check}>
                <span className={cn(MONO, 'w-5 text-[12px]', MUTED)}>{index + 1}</span>
                <Check />
                <span className="text-[16px] text-white">{check}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-col justify-between bg-[#111] p-8 sm:p-12">
            <p className="text-balance text-[24px] leading-[1.35] tracking-[-0.02em] text-white sm:text-[28px]">
              A creative archived after approval never publishes.{' '}
              <span className={MUTED}>
                The worker cancels the post and writes the cancellation to the audit log.
              </span>
            </p>
          </div>
        </div>
      </Section>

      <Section>
        <SectionIntro
          body="Every transition writes to the audit log inside the same transaction, so a state change and its record commit or roll back together. Entries carry the actor, the request ID, and the outcome."
          label="Audit"
          lead="Who decided what,"
          trail="on which version."
        />
        <div className="mt-24">
          <RowTable
            caption="Approval audit events"
            head={['Event', 'What it records']}
            monoLabels
            rows={AUDIT_EVENTS.map(([event, records]) => ({ label: event, cells: [records] }))}
          />
        </div>
      </Section>

      <Section>
        <SectionIntro
          body="Policy-based automatic approval and the Copilot and Autopilot modes are designed and written down, not shipped. The default stays the same: everything needs a person."
          label="What is next"
          lead="Policies later."
          trail="People first."
        />
        <div className="mt-24 grid gap-4 md:grid-cols-2">
          {[
            {
              title: 'Approval policies',
              body: 'Rules a workspace writes for what may publish automatically, such as educational posts, while announcements, metrics, pricing, and competitor mentions always need review.',
            },
            {
              title: 'Autonomy modes',
              body: 'Manual, Copilot, and Autopilot. A mode gates triggers and automatic approval. It never widens what a role may do.',
            },
          ].map((item) => (
            <div className="bg-[#111] p-8 sm:p-10" key={item.title}>
              <AvailabilityPill status="Planned" />
              <h3 className="mt-8 text-[22px] tracking-[-0.015em] text-white">{item.title}</h3>
              <p className={cn('mt-3 text-base leading-[1.6]', MUTED)}>{item.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <FaqBlock
        items={[
          {
            q: 'Can I approve my own posts?',
            a: 'Yes, by default. A solo founder is the creator and the approver. Teams that want separation give creators and approvers different roles.',
          },
          {
            q: 'Can an API key or the AI approve anything?',
            a: 'No. Approval resolves the deciding user from a signed-in session. A principal without a user identity is refused.',
          },
          {
            q: 'Does typing “approve them” in chat approve anything?',
            a: 'No. Approval is a button in the workspace backed by your session, so the record always shows a person.',
          },
          {
            q: 'What happens to a post that needs changes?',
            a: 'It moves to NEEDS_CHANGES with the reviewer’s note. Edit it, or revise it with AI, then submit it again.',
          },
          {
            q: 'Do release emails need approval too?',
            a: 'Yes. Only approved release documents can be announced, and announcing needs the publishing permission.',
          },
        ]}
      />

      <Section>
        <SectionIntro label="Related" lead="Keep reading." trail="Every part connects." />
        <div className="mt-24">
          <LinkCards paths={['/product/publishing', '/security', '/solutions/product-marketing']} />
        </div>
      </Section>
    </MarketingShell>
  )
}
