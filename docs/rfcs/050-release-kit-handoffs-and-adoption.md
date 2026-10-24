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

## Technical design: durable delivery and use ledger

Use the [shared API, transaction and job contracts](../release-readiness-technical-contracts.md).
The manual handoff slice can ship without a provider worker. Automated sends
must use the following persisted intent/attempt protocol; calling an existing
web delivery helper and writing a success flag afterward is insufficient.

### Relations and deduplication

| Proposed table | Fields | Constraints / indexes |
| --- | --- | --- |
| platform_kit_handoff | Release, kit revision/hash, audience, connection/target, payload hash, requester, request time, state, resend/correction parent | Unique org/requester/command-key; same-release kit FK; index org/state/next-attempt-time. |
| platform_kit_handoff_step | Intent, ordered step key, adapter version, request payload object/hash, state, provider object/version/hash | Unique org/intent/step-key; payload immutable once previewed/accepted. |
| platform_kit_handoff_attempt | Step, attempt number, authorization token/hash, credential generation, lease/fencing number, start/end time, outcome, safe error code | Unique org/step/attempt; append-only attempt result; one live attempt lease per step. |
| platform_kit_delivery_receipt | Intent, step, provider object ID/URL, exact kit revision, completed time, receipt origin, reconciliation evidence | Unique org/intent/step/provider-object-ID; manual receipt requires named human and evidence reference. |
| platform_kit_use_event | Release, kit revision, audience, kind, observed/recorded time, evidence reference, supplied/verified actor, verification state, supersedes ID | Unique org/import-source/event-ID; same-release revision; append-only corrections. |
| platform_pilot_import_receipt | Import source/batch ID, canonical payload hash, accepted/staged event IDs, imported-at/by | Unique org/import-source/batch-ID; same-body replay returns same outcome. |

API idempotency deduplicates the same command, not all future sends to a
destination. Derive the durable intent identity from organization, requester
and explicit command key; keep kit/audience/connection/target/payload hash in
the canonical request hash. An explicit resend uses a new key and references
the old intent. Present a recent matching-delivery warning before an accidental
second send, but allow an intentional resend with reason.

Targets are typed IDs, not arbitrary webhook URLs: Slack connection plus
channel ID and optional thread timestamp; Notion connection plus parent page
ID; manual destination label plus access classification and receipt evidence.
Persist the provider account/workspace identity to detect a reconnected
credential pointing at a different account. A channel/page's availability and
connection scope must be verified at preview and execution.

### Preview and command APIs

| Proposed endpoint under /api/v1 | Input / response |
| --- | --- |
| POST /kits/{id}/handoff-previews | Approved revision/hash, audience, typed destination; returns exact payload hash, file list, destination label/account and readiness token. No external send. |
| POST /kits/{id}/handoffs | Preview ID/hash, expected aggregate revision, destination and command key; session-authorized publisher; 202 intent. |
| GET /handoffs/{id} | Per-step state, safe provider receipts, uncertain/retry/repair actions; no credentials. |
| POST /handoffs/{id}/manual-receipts | Exact version/audience/destination, performed-by/time and evidence; session-only; export alone cannot invoke successful delivery automatically. |
| POST /handoffs/{id}/reconcile | Human or bounded internal reconciliation result, provider object identity and supporting observation. Unknown is a valid result. |
| POST /handoffs/{id}/cancel | Cancel pending steps; report already in-flight/delivered effects truthfully. |
| POST /releases/{id}/use-events | Revision, audience, use kind, observed time and evidence; creates pending or human-confirmed record according to authority. |
| POST /pilot-ledger/imports | RFC 045 bounded atomic import with original provenance; no synthesized native approvals. |

Preview is an expiring stored snapshot (15 minutes initially), not an
authorization capability. Requesting handoff reloads the kit, recomputes
readiness and compares destination/payload hashes. Copy sent to the provider
must be rendered from approved artifact text plus fixed transport labels;
freeform factual changes require artifact review. Stable application links
must bind an immutable kit revision and audience scope; a live editor/share
link that follows the latest mutable document is unsuitable.

Customer-facing links use an explicitly approved publication/access scope and
contain no private evidence or internal files. Internal links require workspace
authentication. Tokens grant access only to the approved audience projection,
expire/revoke according to that projection's policy, and are never included in
analytics logs. A token does not bypass a later withdrawal at the resolver.

### Attempt state machine and external-side-effect boundary

```text
PENDING -> AUTHORIZING -> IN_FLIGHT -> DELIVERED
                      \-> BLOCKED
IN_FLIGHT -> RETRY_WAIT       only proven no-side-effect / provider-safe replay
IN_FLIGHT -> UNKNOWN          acceptance cannot be ruled out
IN_FLIGHT -> FAILED           definite terminal rejection
PENDING / RETRY_WAIT -> CANCELLED
UNKNOWN -> DELIVERED / RETRY_WAIT / NEEDS_HUMAN via reconciliation
```

For each step, an activity first locks authority rows, source heads and the
release/intent, verifies current sender and approver authority, exact manifest,
destination scope and connection generation, then persists an IN_FLIGHT
attempt with a 90-second lease and fencing number. Commit before performing
HTTP. Use a 30-second HTTP deadline and a 60-second activity deadline; serialize
steps within an intent. Conditional receipt updates require the fencing number
so a stale activity cannot replace a later reconciliation result.

The authorization commit is the external-send boundary. Revocation committed
before it blocks the send; revocation afterward cancels remaining steps but
cannot guarantee recall of an in-flight request. Record a late successful
receipt plus the revocation/withdrawal warning. Do not claim the material was
never sent because a later check failed. The database transaction never stays
open across provider HTTP.

```text
on retry or recovered activity:
  if DELIVERED receipt exists: return it
  if IN_FLIGHT lease is live: do not send
  if IN_FLIGHT lease expired: mark UNKNOWN and reconcile, do not resend
  if UNKNOWN: query by stored provider ID or supported idempotency marker
  if no reliable reconciliation exists: NEEDS_HUMAN
  if RETRY_WAIT and due: reauthorize, create next fenced attempt, send
```

A crash after marking IN_FLIGHT but before the HTTP request is conservatively
unknown. Provider 429 and explicit validation/auth failures may be classified
as not accepted only according to the adapter's documented response semantics.
Network timeouts, connection resets after writing and generic 5xx responses
are ambiguous by default. Safe retries use Retry-After or exponential jitter
starting at 5 seconds, capped at 5 minutes, at most five attempts in 24 hours.
The generic Temporal activity retry must not automatically repeat a mutating
provider call; it may resume the persisted protocol and reconcile instead.

The intent is DELIVERED only when all required steps have confirmed receipts.
Otherwise show PARTIAL, UNKNOWN, BLOCKED or FAILED with step detail. Complete
successful audience intents survive failures for other audiences. Never
restart an entire Notion append sequence after a partial success.

### Adapter contracts and existing credential ownership

Start with one adapter selected by pilot demand. Both implement preview,
validate-target, execute-step and reconcile-step interfaces. Keep adapter
version and normalized request hash in each step receipt; pin the provider API
version and implement payload-size/chunking tests against its documented limits.

Slack sends an approved summary and immutable audience link. Record channel,
message timestamp and any supported client idempotency marker. A marker is
only a reconciliation hint unless the actual provider contract guarantees
deduplication; lack of lookup permission leads to human reconciliation.

Notion creates a child page and appends bounded groups of blocks. Persist page
creation and every append as separate steps with returned IDs. Store normalized
hashes of blocks written by Shots. Provider limits and API version must be
verified before enabling this adapter; existing image-upload delivery does not
already implement native document conversion. A lost page-create acknowledgment
cannot be solved by automatically creating another page.

Existing Notion credentials are sealed in the web facade using
[AES-GCM v1 envelopes](../../lib/integrations/crypto.ts), while Slack delivery
already runs in Go. A Go Notion worker therefore needs an explicit credential
bridge: add a compatible v1 decoder with shared known-answer tests and mount
the integration key only in the dedicated integration worker. This expands
the current web-only key boundary and must ship with worker secret-access
configuration and log-redaction tests. Do not pass decrypted tokens through
Temporal arguments or expose a general decrypt endpoint. Reuse the existing
connection row, refresh behavior and OAuth consent rather than creating a
second customer connection.

Refresh uses a single-flight connection lease with generation/CAS updates;
no database lock spans the OAuth call. Losing a refresh acknowledgment for a
rotating token requires reconnection if recovery is unavailable. Workers recheck
revocation before storing refresh results so a delayed refresh cannot resurrect
a disconnected integration. Slack-first delivery can ship before this bridge.

Corrections default to appending a newly approved revision with a link to the
old receipt. Replacement is allowed only when a provider offers an atomic
conditional update against the saved remote version. A read-compare-write
without conditional update has a race and is insufficient; append instead.
Never delete or overwrite human additions to a Notion page to make a local
snapshot match.

### Use evidence, import and tests

Use kinds initially are OWNER_CONFIRMATION and PUBLICATION_REFERENCE. Store
PENDING, VERIFIED, RETRACTED and UNAVAILABLE verification states independently
of delivery. Only an authorized human confirms/verifies use; agents may not
turn a provider callback into a human assertion. A human publication review
records the exact revision and audience. RFC 045's cohort algorithm joins
verified use to the same approved/delivered revision. Duplicate and superseded
events are resolved before aggregation.

| Test | Required result |
| --- | --- |
| Same key/body, changed body, deliberate resend | Replay once, conflict, new linked intent respectively. |
| Provider accepts then times out; process dies before/after HTTP | UNKNOWN plus reconciliation; no blind second send. |
| Notion page succeeds, second append fails | Page ID and first append receipt survive; retry only a proven-safe failed step. |
| Membership, source or connection revoked around attempt commit | Before commit blocks; after commit records actual effect and stops remaining work. |
| Corrected content with remote human edits | Conditional update conflicts or append correction; no silent replacement. |
| Private evidence embedded in preview/link/file | Preview rejected before intent creation. |
| Manual receipt, duplicated import, two audience revisions | Export alone is not delivery; repeated import is stable; per-audience adoption chains retain exact versions. |
| Worker/key migration | V1 envelope round trip, wrong key, refresh races and revoked-token response contain no plaintext secret. |

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
