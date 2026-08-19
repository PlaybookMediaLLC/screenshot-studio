# RFC 033: Customer Email and Release Broadcast

**Status:** Implemented
**Date:** 2026-08-19
**Depends on:** RFC 006, RFC 019, RFC 020
**Owners:** Engineering

## Decision

Announcing a release by email is a product capability, not supporting
infrastructure, so it gets the same treatment as capture and publishing:
durable state, idempotent delivery, per-attempt audit, and recipient
consent.

Email is sent through Resend with React Email templates. Delivery runs on
the existing dispatch cron rather than in the request that schedules it.
Marketing automation tools such as Loops or Customer.io are not used.

Announcement delivery reuses the scheduled-post publisher pattern from
RFC 020 rather than introducing a second delivery model.

## Context

The schema from RFC 006 already modelled `CustomerCommunication` and
`CommunicationAttempt`, but nothing read or wrote them. The product could
draft an announcement and never send it.

Authentication email existed but sent a single plaintext string, which
cannot carry a designed announcement and cannot address an audience.
Organization invitations failed outright, because the mail webhook they
depended on was never configured, which blocks the multi-tenant workflow
even in an OAuth-only deployment.

Midday was reviewed as prior art. It runs entirely on Resend, contrary to
the assumption that it uses Loops. Its onboarding drip is one Trigger.dev
task that sleeps between steps with durable waits, and its bulk sender
filters per-recipient notification preferences before building payloads.
Two details were adopted directly: a unique `X-Entity-Ref-ID` per message
to suppress Gmail threading, and filtering recipients before rendering.
One gap was corrected: its bulk sender calls `batch.send` without
chunking, which silently fails once an audience exceeds the provider's
100-message limit.

## Design

### Email package

`lib/email/` exposes rendering, batching, and transport behind a barrel,
so the internal split can change without touching call sites.

Templates are React Email components rendering to both HTML and
plaintext from one source, so the two cannot drift. The text part is not
optional: a message without it scores worse with spam filters and is
unreadable in terminal clients and some screen readers. Styles are inline
because mail clients strip stylesheets, and Gmail removes style blocks
entirely.

Release bodies are tenant-authored. Markdown is flattened to escaped text
paragraphs rather than converted to HTML, which keeps tenant content
inert instead of requiring a converter and a sanitizer on the send path.

Transactional templates carry no unsubscribe link, because a recipient
who opted out of announcements still needs password reset and invitation
mail. The announcement template makes `unsubscribeUrl` required in its
type signature, so a caller cannot omit what CAN-SPAM and bulk sender
rules require.

### Delivery

Bulk sends chunk at 100 messages per request and pace between chunks to
stay inside the provider rate limit. A send that fails partway lands in
the uncertain-delivery state, which requires manual recovery, so avoiding
that is worth the added latency.

Delivery is exactly-once per recipient, enforced by the database rather
than by convention. Each address gets a `CommunicationRecipient` row
under a unique constraint on `(customerCommunicationId, email)`, and only
rows without a `deliveredAt` are sent to. A retry after a partial failure
reaches the remainder without mailing anyone twice.

Dispatch claims a communication with a conditional update, exactly as the
scheduled-post publisher does, so concurrent workers cannot both send
without a lock service.

A worker that died before recording an attempt made no provider call, so
its communication is requeued. Once an attempt exists the send may have
reached the provider, so the communication is failed for human review
instead. Duplicate announcements to customers are worse than late ones.

### Consent

Recipients are resolved at send time, not at scheduling time, so an
unsubscribe between scheduling and delivery is honored.

Consent is per organization: unsubscribing from one tenant's
announcements must not silence another's. Suppression is tracked
separately from unsubscribe, because a hard bounce or complaint must stop
sending even though the customer never asked to leave.

Subscriber addresses are lowercased at the schema boundary. Without
normalization `Customer@example.com` and `customer@example.com` become
separate rows, and an unsubscribe on one would not suppress the other.
Re-importing a list leaves existing rows untouched, so it cannot
resurrect consent for someone who has unsubscribed.

The unsubscribe endpoint is unauthenticated, because recipients have no
account. Authorization is a signed token binding an address to an
organization, compared in constant time. Without the signature the
address in the URL could be edited to unsubscribe anyone. The endpoint
serves both `POST`, for the one-click unsubscribe Gmail and Yahoo require
from bulk senders, and `GET`, for clients that only follow the footer
link.

### Authoring

Only approved release documents may be announced. Announcing is the
irreversible customer-facing step, and a draft sent to customers cannot
be recalled.

An empty audience is refused rather than accepted. Reaching nobody is a
setup mistake rather than an intent to send to no one, and silently
succeeding would hide it until someone asked why no mail arrived.

Announcements are scoped to `publish:manage` rather than `artifact:edit`,
placing them with the permission that already governs customer-facing
publishing instead of with content editing.

## Rejected alternatives

**A marketing automation platform.** Loops, Customer.io, and similar
tools own the audience, the templates, and the send schedule. Release
content already lives in `ReleaseDocument` under an approval workflow, so
an external tool would either duplicate that state or require syncing it
outward. The delivery semantics that matter here, exactly-once per
recipient and per-attempt audit, are also weaker in those tools than what
the existing publisher pattern already provides.

**Sending inside the scheduling request.** A slow or failing provider
would block the request, and a scheduled announcement would not survive a
deploy or restart. Recording intent and dispatching from cron reuses the
durability already built for scheduled posts.

**Markdown-to-HTML conversion for release bodies.** Rendering
tenant-authored Markdown means shipping a converter and sanitizing its
output on the send path. Flattening to escaped text is inert by
construction, and richer formatting can be added later behind an explicit
allowlist if the product needs it.

**A monorepo workspace split.** Extracting `lib/email` into a published
workspace package was considered and rejected. This repository has one
deployable application, so every package boundary would serve exactly one
consumer while adding workspace-aware Docker builds, Prisma generation
across package boundaries, and standalone output tracing through symlinked
packages. The `server-only` guards already enforce the boundaries that
matter, and a barrel export already gives a stable public surface. This
becomes worth revisiting when a second deployable exists, such as an
extracted Trigger.dev worker or a separate marketing site.

## Exit criterion

An approved `ReleaseDocument` schedules an announcement, the dispatch
cron delivers it to every subscribed customer exactly once, each attempt
is recorded with its provider message ID, and a recipient who uses the
unsubscribe link is excluded from the next announcement.

Met. Verified against the production database: the approval gate, the
empty-audience gate, idempotent replay, cancellation, and tenant
isolation. A templated announcement was rendered and accepted by the
provider. In production, a validly signed unsubscribe token returns 204
and a forged one returns 400.

## Out of scope

- **Lifecycle drip sequences.** Trigger.dev durable waits make onboarding
  and trial sequences straightforward, following Midday's `onboard-team`
  task, but a drip is a separate product decision from announcing a
  release.
- **An authoring UI.** The tRPC procedures exist and are callable; no
  screen reaches them yet.
- **Bounce and complaint ingestion.** `suppressedAt` is modelled and
  respected, but no provider webhook writes to it, so suppression is
  currently manual.
- **Deliverability warmup.** The sending domain has only carried
  authentication volume. A large first announcement should be ramped, and
  a dedicated announcement subdomain is worth considering before volume
  grows.
