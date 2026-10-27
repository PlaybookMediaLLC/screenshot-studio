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
import { MONO, MUTED, Section, SectionIntro } from '../primitives'
import { ApprovalFlow } from '../diagrams/ApprovalFlow'
import { ApprovalGates } from '../diagrams/ApprovalGates'
import { AutonomyLadder } from '../diagrams/AutonomyLadder'

const DECISION_LABELS: Record<CampaignApprovalDecision, string> = {
  submit: 'Submit for review',
  approve: 'Approve',
  reject: 'Reject',
  request_changes: 'Request changes',
}

const DECISIONS: CampaignApprovalDecision[] = ['submit', 'approve', 'reject', 'request_changes']

/** Permissions worth showing a buyer, in reading order. */
const PERMISSION_ROWS: { permission: Permission; label: string }[] = [
  { permission: 'artifact:read', label: 'Read launches and visuals' },
  { permission: 'release:create', label: 'Create releases and submit posts' },
  { permission: 'artifact:edit', label: 'Edit drafts and visuals' },
  { permission: 'release:approve', label: 'Approve, reject, request changes' },
  { permission: 'publish:manage', label: 'Schedule and cancel posts' },
  { permission: 'brand:manage', label: 'Manage brand and product' },
  { permission: 'member:invite', label: 'Invite teammates' },
  { permission: 'audit:read', label: 'Read the audit log' },
  { permission: 'identity:manage', label: 'Configure SSO and SCIM' },
  { permission: 'workspace:delete', label: 'Delete the workspace' },
]

const rolesWith = (permission: Permission) =>
  organizationRoles.filter((role) => hasPermission(role, permission)).join(', ')

const AUDIT_EVENTS = [
  ['product.campaign_created', 'A campaign and its post count'],
  ['product.campaign_post_status_changed', 'A decision and how many posts it covered'],
  ['product.campaign_post_scheduled', 'The campaign and the scheduled post'],
  ['post.scheduled', 'The destination and the visual'],
  ['post.cancelled', 'Who cancelled it'],
  ['post.published', 'The provider post ID'],
  ['post.publish_recovery_required', 'The failure code, for a teammate to resolve'],
] as const

/** /product/approvals: the state machine, roles, batch semantics, scheduling gate, and audit. */
export function ApprovalsPage() {
  return (
    <MarketingShell finale={{ lead: 'Invite your team', trail: 'and choose who approves.' }}>
      <PageHero
        body="Every post waits for approval before it can be scheduled. Working alone? You can approve your own posts. Teams can give writing, approving, and publishing to different people. The server enforces these rules for the browser, the API, and the AI."
        eyebrow={{ href: '/product', label: 'Approvals', parent: 'Product' }}
        lead="You decide what goes out."
        location="approvals_hero"
        trail="Approve your own posts, or require a second teammate."
      >
        <HeroStage variant={2}>
          <ApprovalFlow />
        </HeroStage>
      </PageHero>

      <Section>
        <SectionIntro
          body="This table comes straight from the rules the server enforces. Every decision needs a signed-in teammate. A decision made from the wrong starting state is refused, and no admin override exists."
          label="Transitions"
          lead="Four decisions move a post,"
          trail="and the server checks each one."
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
        <PullQuote quote="Every approval records the teammate who gave it. An API key can create a release, but it cannot approve a post." />
      </div>

      <Section>
        <SectionIntro
          body="The fixed roles separate writing, approval, publishing, and administration. An approver can sign off without publishing rights, and a publisher can schedule without approval rights. A solo founder holds every role and can approve their own posts."
          label="Roles"
          lead="Approving and publishing"
          trail="are separate permissions."
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
          body="Approving six posts takes one click and writes one audit entry."
          label="Batch"
          lead="Approve every post in one click,"
          trail="or pick exactly the ones you want."
        />
        <div className="mt-24">
          <TileGrid
            columns={2}
            items={[
              {
                snippet: 'postIds: omitted',
                title: 'Every eligible post',
                body: 'Leave the list out and the decision applies to every post in the launch that can take it. That is the Approve all button.',
              },
              {
                snippet: 'postIds: [a, b, c]',
                title: 'Exactly these posts',
                body: 'Name the posts and the call is all or nothing. If one is not eligible, nothing changes and the call returns 409.',
              },
              {
                snippet: '409 · nothing eligible',
                title: 'No silent success',
                body: 'Click Approve twice and the second click returns a clear conflict error.',
              },
              {
                snippet: 'one winner, one 409',
                title: 'Concurrent reviewers',
                body: 'Two approvers acting at once get one success and one conflict. Nothing is locked while a reviewer reads.',
              },
            ]}
          />
        </div>
      </Section>

      <Section>
        <SectionIntro
          body="Approval and scheduling are separate steps. Scheduling checks the post again. Right before sending, Shots checks the visual a third time."
          label="Scheduling"
          lead="Six checks run before a post is scheduled,"
          trail="and the visual is checked again at send time."
        />
        <div className="mt-24">
          <ApprovalGates />
        </div>
      </Section>

      <Section>
        <SectionIntro
          body="Every decision is saved together with its audit entry, so neither can exist without the other. Entries carry the teammate, the request ID, and the outcome."
          label="Audit"
          lead="The audit log shows who decided what"
          trail="and on which version."
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
          body="Approval rules and the Copilot and Autopilot modes are designed and written down. None of them ship today, so every post still needs a teammate."
          label="What is next"
          lead="Automatic approval rules are planned"
          trail="and stay off until you turn them on."
        />
        <div className="mt-24">
          <AutonomyLadder />
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {[
            {
              title: 'Approval rules',
              body: 'Rules your workspace writes for what may publish automatically, such as educational posts. Announcements, metrics, pricing, and competitor mentions always need review.',
            },
            {
              title: 'Autonomy modes',
              body: 'Manual, Copilot, and Autopilot. A mode controls what starts on its own and what is approved automatically. It never gives a role more permissions.',
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
            a: 'No. Approval requires a signed-in teammate. A request from an API key or the AI has no teammate behind it, so it is refused.',
          },
          {
            q: 'Does typing "approve them" in chat approve anything?',
            a: 'No. Approval is a button in the workspace tied to your login, so the record always shows a teammate.',
          },
          {
            q: 'What happens to a post that needs changes?',
            a: "It moves to NEEDS_CHANGES with the reviewer's note. Edit it, or revise it with AI, then submit it again.",
          },
          {
            q: 'Do release emails need approval too?',
            a: 'Yes. Shots sends a release email only for an approved release, and sending needs the publishing permission.',
          },
        ]}
      />

      <Section>
        <SectionIntro
          label="Related"
          lead="Next: how approved posts get published,"
          trail="plus security controls and team roles."
        />
        <div className="mt-24">
          <LinkCards paths={['/product/publishing', '/security', '/solutions/product-marketing']} />
        </div>
      </Section>
    </MarketingShell>
  )
}
