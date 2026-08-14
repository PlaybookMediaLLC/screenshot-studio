# RFC 001: Guided Release Kit

**Status:** Proposed
**Date:** 2026-08-13
**Owners:** Product and Engineering
**Depends on:** RFC 002 and RFC 003

## Decision

Turn Screenshot Studio into a cloud workflow for product launches. A team
creates a release, runs an approved browser-capture recipe, produces on-brand
variants, reviews them, and schedules approved posts.

Keep the existing local editor free and useful. The paid product is the
reliable, tenant-safe workflow around it, not a more complex blank canvas.

Each release is also the source of truth for customer communication. An
approved Markdown release note can produce a public changelog, an in-app
update, a customer email, and channel-specific social drafts.

Use Trigger.dev Cloud for durable capture, export, publishing, retries, and
scheduled work. PlanetScale Postgres stores product state and audit evidence.
Steel Browser runs as a separate private capture service.

## Context

The application can currently edit screenshots and export visual assets. It
has a public URL screenshot route backed by Microlink, static R2 asset support,
and a small Prisma schema with a global screenshot cache. It does not yet have
users, workspaces, durable releases, approvals, or publication integrations.

Steel Browser can execute isolated browser sessions and screenshots through an
API. It is not a tenant, campaign, approval, or scheduling system. Screenshot
Studio owns that data and invokes Steel from a Trigger.dev task.

The product statement is a hypothesis to validate with app marketers: **turn
an app update into a launch kit in ten minutes**. All content has a human
review gate before publication.

## Goals

- Give one marketer a guided release workflow.
- Capture real product flows, never fabricate a demo.
- Generate reusable channel variants from a brand kit and template.
- Preserve the recipe, asset, approval, and publication lineage.
- Let a team review and schedule work without sharing browser credentials.
- Help a founder explain each meaningful release to existing customers before
  the release becomes old news.
- Make one approved Markdown document reusable across owned and public
  channels without copying, pasting, or losing the product truth.
- Keep the local editor as the free acquisition path.

## Non-goals

- Autonomous social posting without an approval.
- A general CRM or marketing automation suite.
- Recording arbitrary customer production systems.
- Replacing Steel Browser, a social provider, or an identity provider.
- An AI agent that makes final creative or publishing decisions.

## User workflow

```text
Release brief + recipe
  -> Trigger.dev task
  -> private Steel Browser session
  -> immutable R2 source asset
  -> Screenshot Studio template variants
  -> approved Markdown release note
  -> human review and approval
  -> scheduled social and customer communication tasks
  -> provider delivery receipt
```

1. A creator selects a source app and writes one benefit statement.
2. The creator chooses a versioned capture recipe. It includes the approved
   hostname, viewport, and steps plus a secret reference, never a raw secret.
3. A Trigger.dev capture task asks the private Steel worker to run the recipe.
   The capture is stored in R2 and its metadata is stored in PlanetScale.
4. Screenshot Studio makes wide, square, and vertical variants from a versioned
   brand kit and template. Each variant can still be edited.
5. An approver accepts or rejects a variant. Rejection records a reason.
6. A founder writes or reviews one Markdown release note. It states what
   changed, who benefits, availability, known limits, and one next action.
7. A publisher schedules approved variants and customer communications. A
   Trigger.dev task calls the connected provider and stores the provider
   receipt or actionable failure.

### Release state

```text
DRAFT
  -> CAPTURE_QUEUED -> CAPTURING -> ASSET_READY
  -> REVIEW_REQUIRED -> APPROVED -> SCHEDULED
  -> PUBLISHING -> PUBLISHED
                    \-> FAILED
```

`FAILED` is recoverable only for safe retry classes. `PUBLISHED` is terminal
for a post. A correction creates a new variant and post record. Every state
change creates an audit event.

## First release

The pilot supports one approved public product URL, one capture recipe, one
brand kit, one template family, three aspect ratios, one human approval, and
either one publication destination or a downloadable handoff.

| Capability | Pilot | Later |
| --- | --- | --- |
| Capture | One approved recipe per release | Reusable release-triggered recipes |
| Variants | Wide, square, vertical | Localization, store media, GIF, video |
| Approval | One required approval | Policies, escalation, separate approvers |
| Delivery | Download or one provider | Multi-channel calendar and reporting |
| Customer communication | One Markdown note, public changelog, or one email segment | In-app updates, docs, segmentation, response reporting |
| Templates | One versioned brand template | Controlled template library |

## Founder problem and customer communication

### Problem to solve

The founder problem is not merely scheduling social posts. A small SaaS team
ships product changes but does not turn them into useful customer communication
before the moment passes. The work is fragmented: capture the product, make an
asset, write the update, copy it into an email tool and a changelog, then try
to explain it again on social.

The product promise is: **every meaningful product update becomes a clear,
approved customer communication within 72 hours.** This is a product goal to
measure, not a guaranteed customer outcome.

The north-star metric is the percentage of meaningful releases with at least
one approved communication delivered within 72 hours. Supporting measures are
time from release to first draft, approval time, delivery success, click-through
to the named action, and customer feedback. Views and likes are not sufficient
evidence of value.

### Markdown is the source of truth

Each release owns one versioned Markdown document. It is written by a founder
or marketer, assisted only with clearly labelled suggestions, and approved by
a human. A revision never overwrites an approved document.

```md
---
title: Saved brand kits
audience: Existing customers
availability: Pro plan
cta: Create your first brand kit
release: rel_123
---

## What's new

Save your logo, colors, and default layout once, then reuse them for each
release.

## Why it matters

Your launch assets now stay consistent without rebuilding the same design.

## Try it

Create a brand kit from **Settings → Brand**.
```

Front matter contains validated structured facts. Markdown contains the human
explanation. The renderer creates each channel format from the same approved
revision:

| Output | Job | Native treatment |
| --- | --- | --- |
| Public changelog | Discoverability and trust | Rendered Markdown at a stable public URL |
| In-app update | Activation | Short summary, image or GIF, and deep link to the feature |
| Customer email | Retention and re-engagement | Safe HTML email with one audience-specific CTA |
| Help or docs update | Adoption | Expanded Markdown with setup, limitation, and troubleshooting links |
| Social post | Awareness and conversation | A distinct, short proof-led draft; not a pasted release note |

The system must sanitize rendered Markdown, block unsafe HTML and scripts, and
create asset-specific signed URLs. It must not expose private capture media in
a public changelog or email.

### Communication workflow

```text
release brief + real product asset
  -> approved Markdown source
  -> channel-specific rendering and copy draft
  -> human content approval
  -> scheduled delivery
  -> delivery receipt, reply, and performance record
```

The first release supports a public changelog or one customer email segment.
For email, Screenshot Studio stores only a reference to the customer's audience
or segment in their chosen delivery provider. It is not a contact database,
bulk-email platform, or subscriber-management system. The customer controls
consent, unsubscribe, sender identity, and audience rules in that provider.

In-app updates should target product state, such as plan, role, or feature
access, rather than importing a customer list. A customer who cannot use a
feature must not receive a misleading announcement for it.

Use one content document per release, then make channel variants only where
the audience needs a different explanation. A social post may lead with a
sharp product observation; an existing customer email should lead with the
change, availability, and the action they can take now. Every variant links to
the same release and source asset lineage.

## Service design

| Service | Responsibility | Must not do |
| --- | --- | --- |
| Next.js application | Workspace UI, authorization, editor, review | Run Chromium or retain browser credentials |
| PlanetScale Postgres | Tenant state, audit trail, outbox | Store media binaries or raw tokens |
| Trigger.dev Cloud | Scheduling, retries, concurrency, task visibility | Act as the tenant authority |
| Steel worker | Execute one isolated browser session | Accept public requests or decide permissions |
| R2 | Store source and generated media | Provide tenant-wide public read access |
| Social provider | Publish an approved post | Determine approval or retry policy |

A state change writes its application row, audit event, and outbox event in one
PlanetScale transaction. A short dispatcher triggers the corresponding
Trigger.dev task using an idempotency key. Trigger.dev handles durable waits,
retries, scheduling, and concurrency; PlanetScale remains the record of what
the task is allowed to do.

Do not implement a custom polling queue. If provider cost becomes material,
the outbox can later deliver to Cloudflare Queues without changing the release
or audit model.

### Trigger.dev cost decision

Trigger.dev is the first choice because this product needs durable scheduled
work, retries, visibility, and long waits. Its current Hobby plan is $10/month
with $10 credits. On the Small-1x machine, a 60-second run is approximately
$0.0021 before credits, including the per-run charge. A task waiting longer
than five seconds is checkpointed and does not consume compute time.

Cloudflare Queues is the low-cost scale fallback: paid accounts include one
million operations monthly, then charge $0.40 per million operations. A normal
message uses a write, read, and delete. It still requires us to run and
observe the browser and publisher consumers, and does not provide a direct
durable workflow replacement. Inngest starts at $99/month for production,
so it is not the cost choice for this product today.

Review the decision when Trigger.dev cost exceeds the cost of operating a
queue and workers, or when capture volume exceeds 100,000 runs per month.

## Asset lineage

Every exported or published asset links to immutable identifiers:

```text
source app -> capture recipe version -> capture -> source asset
           -> brand kit version + template version -> variant
           -> approval -> scheduled post -> publication attempt / receipt
```

An edit creates a new variant revision. It never overwrites an approved
revision. Recipe, template, and brand-kit versions are copied to the result so
later edits cannot rewrite history.

## Permissions

Permissions are organization-scoped. Signing in gives no default access.

| Role | Main permissions |
| --- | --- |
| Owner | Billing, org deletion, SSO/SCIM, access policy, all content |
| Admin | Members, brand kits, templates, connections, release work |
| Creator | Draft releases, run permitted captures, edit variants |
| Approver | Approve or reject content; cannot alter a source recipe |
| Publisher | Schedule and publish approved variants |
| Viewer | Read permitted work and audit history |

Enterprise policy can require a different approver from the creator. The pilot
may allow a creator to approve their own work, but records that fact.

## Security and privacy

- Capture only organization allow-listed hosts. Resolve before every request and
  block loopback, private, link-local, and cloud-metadata addresses. Resolve
  again after redirects to prevent DNS rebinding.
- Use dedicated demo accounts. Store secret references only. Do not store
  browser passwords, session cookies, or social tokens in a recipe, task
  payload, asset, audit event, or application log.
- Generate short-lived, organization-checked R2 URLs. Object keys begin with
  `org/<organization-id>/`; do not make tenant media generally public.
- Give each Trigger.dev task a minimal payload: IDs, version IDs, and an
  idempotency key. The task re-reads and authorizes the record from PlanetScale.
- Steel is private, has restricted egress where possible, uses hard runtime
  limits, and destroys its browser context after each capture.
- The existing public screenshot route remains a separate public feature. It
  cannot capture private release-kit flows.

## Service targets and support contract

These are release targets, not current production commitments.

| Area | Target | Failure behavior |
| --- | --- | --- |
| Create release or queue task | p95 under 1 second | Retry-safe error with request ID |
| Trigger task start | p95 under 60 seconds | Alert after 5 minutes queued |
| Normal page capture | p95 under 2 minutes | Safe retry or redacted failure code |
| Variant generation | p95 under 30 seconds | Keep source asset and retry only generation |
| Audit write | Same transaction as state change | Reject the action if audit write fails |
| Scheduled post | Start within 2 minutes of due time | Never duplicate a post |

Support uses a customer-approved, time-bounded, read-only support grant. It
cannot read secrets, browser credentials, or unredacted asset URLs. Each
support action is audited and the grant expires automatically.

## Rollout

1. Add Better Auth, PlanetScale tenant tables, and access checks from RFC 002
   and RFC 003.
2. Ship release drafts, versioned Markdown notes, a public changelog, brand
   kits, R2 media, variants, and approval without Steel or social APIs.
   Validate the workflow with design partners.
3. Add Trigger.dev tasks and the private Steel integration for approved public
   or dedicated-demo URLs.
4. Add one social provider with idempotency and a manual-download fallback.
5. Add enterprise SSO, SCIM, log export, and further regional worker capacity
   when customer demand requires them.

## Acceptance criteria

- Cross-organization IDs cannot read, mutate, sign, or schedule data or R2
  objects.
- A capture has recipe version, source URL, source asset, and complete audits.
- A rejected asset cannot be scheduled. A changed approved asset needs a new
  approval.
- An approved Markdown revision renders safely to a public changelog and one
  customer communication without exposing private media or secrets.
- A founder can link an in-app update, customer email, and social variant to
  one release, then see the delivery status for each channel.
- A Trigger retry or provider timeout cannot create a duplicate post.
- A blocked network target fails before a browser starts.
- Support access has explicit expiry and a complete audit trail.
- The existing editor and public screenshot route keep working during the pilot.
