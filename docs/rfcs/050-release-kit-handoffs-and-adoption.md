# RFC 050: Release-Kit Handoffs and Adoption Evidence

**Status:** Proposed
**Date:** 2026-10-23
**Owners:** Product Engineering
**Depends on:** RFC 005, RFC 019, RFC 034, RFC 045, RFC 049
**Execution:** Milestone 3 in the [RFC execution order](README.md)

## Decision

Deliver an exact approved kit revision into the tools customers already use,
starting with exports and the existing Slack/Notion connections. Record which
audience received which materials and separate provider acceptance from
downstream use. No social-network expansion or customer migration is required.

## Existing foundation

[Design delivery](../../lib/integrations/deliver.ts) uploads media to Notion and
adds a Figma comment; [share delivery](../../lib/integrations/server.ts) also
uses backend Slack delivery. [Outbound webhooks](../outbound-webhooks.md) expose
draft events. These can inform adapter design but do not yet provide an
approved release-kit delivery ledger. Do not claim a Figma comment is an
editable design or an image upload is a native release document.

## Proposed contract

```text
Handoff intent
  workspace, canonical release, approved kit revision and manifest hash
  audience, destination connection, exact channel/page/path, content scope
  requesting human, authorization time, idempotency key
Delivery receipt
  intent ID, attempt, status, provider object IDs/URLs, delivered revision
  accepted/completed/failed/uncertain times, retry/reconciliation reason
Use evidence
  release, kit revision, audience, evidence kind, supplied-by, observed-at
  source reference and verification state; separate from delivery state
```

Required audiences and destinations are reviewed before sending. The requester
sees the exact payload and confirms the destination. Permission to approve
content is not blanket permission to send to arbitrary recipients. Recheck
current membership, connection scope, kit readiness and audience classification
at execution; never include private review evidence in a customer payload.

## Delivery behavior

1. Ship downloadable Markdown/image bundles and a manual handoff receipt first.
   A download is an export event; an operator must record the actual destination
   and handoff before it counts as delivered.
2. Add Slack summaries linking approved, audience-appropriate materials and
   Notion pages/blocks containing the relevant role-specific documents. Store
   provider object IDs and URLs. Choose the first automated adapter from pilot
   demand; do not require both to deliver customer value.
3. Reuse the Go outbox and Temporal for persisted intents and bounded retries.
   Deduplicate on workspace + kit revision + audience + destination + send
   intent. An explicit resend is a new intent, visibly linked to the original.
4. If a provider times out after possibly accepting a request, mark delivery
   uncertain and reconcile using provider IDs/idempotency support. Where that
   is impossible, require a human resolution before retrying. Do not promise
   exactly-once delivery to providers that cannot support it.
5. A later correction produces a new approved kit revision and a reviewed
   update intent referencing the old receipt. Do not silently overwrite remote
   content or delete another person's edits. Use a content/version comparison
   where supported; otherwise append a clearly identified correction or export.

For partial failures, show per-audience status and retry only the failed known
safe step. Provider quotas, credential revocation, permission loss and deleted
destinations have actionable states. Disabling a connection stops pending work
without pretending previously delivered material was recalled.

## Adoption and metrics

Implement RFC 045's ledger as durable, workspace-scoped events associated with
the canonical release and artifact revisions. Accept explicit sales/CS use
confirmation and verifiable customer publication/use records. Reject duplicate
events. Missing evidence stays unknown; delivery, clicks, email opens and
impressions alone do not become use or comprehension.

Migrate assisted pilot records with their original actor, time, evidence and
confidence. If provenance is missing, retain an incomplete record rather than
backfilling a successful outcome. Reports show eligible releases, required
audiences, adopted release count, repeat use, cost and correction rate.

## Acceptance criteria

1. An approved kit can be exported and manually handed off with a traceable
   version/destination record, even when all provider adapters are disabled.
2. At least one pilot-selected Slack or Notion handoff works end to end in a
   non-production workspace, with exact payload preview and provider receipt.
3. Duplicate intents and safe retries do not create duplicates; ambiguous
   provider outcomes stop for reconciliation rather than blind replay.
4. A revoked connection, stale approval, withdrawn release or tenant mismatch
   prevents a new send and produces an actionable status.
5. Private source material cannot cross into a customer-facing bundle through
   a link, preview or provider attachment.
6. A correction links old and new receipts and detects conflicting remote edits
   rather than silently replacing them.
7. Adoption reporting distinguishes export, handoff, provider acceptance and
   use; one release counts once across revisions, destinations and retries.
8. Fake-provider tests cover timeout-after-acceptance, permission loss, partial
   failure and correction conflicts; a controlled live test validates the
   first adapter before describing it as production-ready.

## Observability

Required audiences with recorded use is the primary product outcome, alongside
adopted releases from RFC 045. Delivery success and uncertain-outcome age are
operational measures. Review use evidence with customers instead of treating
adapter success as proof of adoption.

## Rollout and rollback

Start with manual export receipts, then one adapter in the pilot cohort.
Provider-specific switches stop new intents and workers; historical receipts
and use evidence remain accessible. Export is the fallback. Keep existing
design delivery compatible and avoid adding unrelated social adapters.
