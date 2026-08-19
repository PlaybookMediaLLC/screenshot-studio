# Email delivery and release broadcast

Screenshot Studio exists to help teams announce releases. Announcing a
release to customers by email is therefore a product capability, not
supporting infrastructure, and it deserves the same treatment as capture
and publishing: durable state, idempotent delivery, per-attempt audit,
and recipient consent.

This document is the implementation plan. It records what exists, what is
missing, what will be built, and the decisions behind the design.

## What exists today

`lib/auth/email.ts` sends a single plaintext message through Resend, with
a webhook fallback. It has no templates, no batching, no preference
checks, and no delivery record. It was built to unblock authentication
email, and it does that correctly, but it cannot serve a broadcast.

The Prisma schema already models the destination state:

- `Release` and `ReleaseDocument` carry approved release content.
- `CustomerCommunication` models one announcement on one channel, with
  `idempotencyKey`, `scheduledFor`, `status`, and `triggerRunId`.
- `CommunicationAttempt` models each delivery attempt, with
  `attemptNumber`, `outcome`, `providerMessageId`, and `failureCode`.

None of these models have any implementation. The tables exist and are
migrated; nothing reads or writes them. Closing that gap is the work.

`lib/tenant/publishing.ts` already implements this exact shape for social
posts: claim a row with a conditional update, record an attempt, call the
provider, then resolve the attempt and write an audit log. The broadcast
path will follow that structure rather than inventing a second one.

## Goals

1. A real templating engine, so email is authored as components with a
   shared layout, not as string concatenation.
2. Batched sending that respects provider limits and per-recipient
   consent.
3. Exactly-once delivery per recipient per release, enforced by the
   database rather than by convention.
4. Every send observable: which recipients, which attempt, which provider
   message ID, which failure.

## Non-goals

Marketing automation, drip campaigns, and behavioral sequences are out of
scope for this change. Midday runs those on Trigger.dev durable waits,
and that pattern remains available here, but a lifecycle drip is a
separate product decision from announcing a release. Building the
broadcast path first keeps the change reviewable and delivers the
capability the product is actually about.

## Design

### The email package

```
lib/email/
  render.ts        Render a React Email component to HTML and text
  transport.ts     Resend client, batching, chunking, retries
  send.ts          Public API: sendEmail, sendBulkEmail
  templates/
    layout.tsx     Shared shell: brand header, footer, unsubscribe slot
    invitation.tsx
    release-announcement.tsx
    verification.tsx
    password-reset.tsx
```

**React Email** is the templating engine. It renders React components to
HTML with inlined styles and table-based layouts, which is what email
clients require. The alternative, a string template language, would mean
maintaining a second component vocabulary and hand-writing the table
markup that Outlook needs.

Every template renders both HTML and a plaintext alternative. A message
with no text part is scored as spam by several providers, and plaintext
is what screen readers and terminal clients display.

### Batching and chunking

Resend's batch endpoint accepts **100 messages per call**. Midday's
implementation calls `batch.send(payloads)` with no chunking, which is
correct at their volume and silently truncates past it. This
implementation chunks explicitly and reports per-chunk outcomes, because
a release announcement is exactly the case that exceeds 100 recipients.

Batch send does not support attachments. When any payload carries one,
the transport falls back to individual sends, as Midday does.

Every message carries an `X-Entity-Ref-ID` header with a unique value.
Gmail threads messages with identical subjects into a single
conversation; for a release announcement that collapses the whole send
into one unreadable thread for anyone who receives more than one.

### Consent

Recipients are filtered **before** payloads are built, not at send time.
Building 500 payloads to discard 200 wastes render time and, more
importantly, makes it easy to accidentally send when a later refactor
moves the check.

Announcement email is commercial, so it requires:

- A per-recipient subscription record with an explicit opt-out.
- A `List-Unsubscribe` header and a working one-click endpoint, which
  Gmail and Yahoo require for bulk senders.
- Suppression of addresses that previously hard-bounced or complained.

Transactional email, meaning verification, password reset, and
invitation, is exempt from the opt-out check. A user who unsubscribed
from announcements still needs their password reset link.

### Idempotency

`CustomerCommunication` already has `@@unique([organizationId, idempotencyKey])`.
The broadcast claims a communication with a conditional update, exactly
as `publishing.ts` claims a scheduled post:

```
UPDATE customer_communication SET status = 'PROCESSING'
WHERE id = ? AND status = 'SCHEDULED' AND scheduledFor <= now()
```

If the update affects zero rows, another worker already claimed it and
this worker stops. That makes concurrent dispatchers safe without a lock
service.

Per-recipient delivery needs its own guard, because a batch that fails
halfway must not re-send to recipients who already received the message.
A `CommunicationRecipient` row per address, with a unique constraint on
`(customerCommunicationId, email)` and a `deliveredAt` timestamp, gives
exactly-once semantics on retry.

### Failure handling

A provider error fails the attempt and leaves the communication
retryable, up to a bounded attempt count. A send that starts but does not
confirm is the dangerous case: retrying risks duplicate delivery, and not
retrying risks silent non-delivery. `publishing.ts` resolves this by
marking uncertain stale rows `FAILED` with a `UNKNOWN_DELIVERY` code and
requiring human recovery. The broadcast path uses the same rule, since
duplicate announcements to customers are worse than a delayed one.

## Plan

### Phase 1: email package

1. Add `resend`, `react-email`, and `@react-email/components`.
2. Build `render.ts`, returning `{ html, text }` from one component.
3. Build `transport.ts`: chunking at 100, attachment fallback,
   `X-Entity-Ref-ID`, structured `{ sent, failed, skipped }` results.
4. Build the shared `layout.tsx` and the transactional templates.
5. Move `lib/auth/email.ts` onto the package, preserving the webhook
   fallback and the existing environment contract.

Verification: rendered snapshots asserted for both parts, chunk boundary
tested at 99/100/101 payloads, auth email still sends in production.

### Phase 2: broadcast

6. Migration: `CommunicationRecipient`, plus subscription and suppression
   state on the recipient model.
7. `lib/tenant/communications.ts`: create, schedule, claim, dispatch,
   resolve, mirroring `publishing.ts`.
8. One-click unsubscribe endpoint with a signed token, so the link cannot
   be forged to unsubscribe another address.
9. tRPC procedures for creating and scheduling an announcement from an
   approved `ReleaseDocument`.
10. Trigger.dev task on the existing cron to dispatch due communications.

Verification: tenant isolation asserted, idempotency asserted by
dispatching the same communication twice and expecting one delivery per
recipient, unsubscribe asserted to suppress a subsequent send, audit rows
asserted for each attempt.

## Risks

**Deliverability.** A domain that has only ever sent authentication email
has no reputation for bulk. The first large announcement should be warmed
gradually, and `oppulence.app` already carries other traffic, so a
separate subdomain for announcements is worth considering before volume
grows.

**Compliance.** Commercial email requires a physical postal address and a
working unsubscribe under CAN-SPAM, and a lawful basis plus withdrawal
under GDPR. The unsubscribe endpoint and the address in the footer are
requirements, not polish.

**Provider limits.** Resend rate-limits requests per second. Chunked
sends need backoff, or a large announcement will fail partway and land in
the uncertain-delivery path.
