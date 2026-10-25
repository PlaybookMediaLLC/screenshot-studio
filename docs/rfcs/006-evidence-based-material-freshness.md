# RFC 006: Evidence-Based Material Freshness

**Priority:** 006 — Active delivery
**Previous ID:** 051 ([renumbering map](renumbering-2026-10-24.md))
**Status:** Proposed — after repeat release-kit use
**Date:** 2026-10-23
**Owners:** Product Engineering
**Depends on:** RFC 003, RFC 004, RFC 005
**Reuses:** RFC 018, RFC 029
**Execution:** Milestone 4 in the [RFC execution order](README.md)

## Decision

Connect later product/source changes to the approved claims, screenshots, kits
and delivery destinations they may affect. Create a focused human review queue
and proposed updates. Do not automatically rewrite approved or delivered
materials, and do not call an old screenshot incorrect based on age alone.

## Existing foundation

[Surface freshness](../../lib/tenant/surface-freshness.ts) uses a 30-day capture
age. [Surface capture history](../../services/internal/product/surfaces.go)
records supersession, and [revision proposals](../../lib/ai/launch/revise.ts)
let reviewers apply or discard changes. Reuse those primitives, adding the
claim/evidence and kit/destination lineage from the preceding RFCs.

## Proposed lifecycle

```text
Changed source version / release / capture / human report
  → compare with pinned evidence
  → locate affected claim versions and screenshot dependencies
  → locate approved kit revisions and delivered destinations
  → create deduplicated freshness finding
  → human confirms still valid, replaces evidence, revises or withdraws
  → verify revised facts, approve new kit, review correction handoff
```

A finding records workspace, triggering evidence/version, affected IDs,
reason, confidence as a suggestion, owner, detected time and resolution history.
Distinguish evidence changed, source unavailable, review overdue, suspected
conflict and confirmed invalid. Only human review can resolve semantic validity.
A fetch error is not a contradiction; unchanged bytes are not proof that an
unobserved product behavior is still valid.

## First useful slice

Start with manual “this fact or image changed” reports and exact source/capture
version changes. An indexed dependency lookup can show affected materials
without an LLM or a broad crawler. Add bounded scheduled checks only for
authorized, registered sources after this queue is useful.

Compare normalized text and screenshot metadata/content to suppress obvious
noise, but present the before/after evidence and reason. Stable claim IDs from
RFC 003 are essential: list reordering must not look like changed product
facts. Deduplicate by source transition plus affected artifact and retain one
open actionable finding per cause. Do not notify for every polling result.

Re-evaluate readiness before new delivery of affected material. A confirmed
invalid or withdrawn fact blocks new approved handoffs immediately. Other
material changes require review of the affected dependency before another
approved handoff; review-overdue policy must be explicit and cannot silently
certify freshness. Preserve original approval/receipt history and display its
current warning state. A reviewer can confirm still valid with new evidence
without altering the old artifact bytes.

## Safety, costs and migration

Use existing organization access checks, registered source fetch limits,
Temporal/outbox execution and metering. Schedule bounded checks with per-workspace
budgets and backoff. Honor source access revocation and retention; deletion
leaves only permitted lineage/tombstones and an unavailable-evidence state.
Private source content stays in the review surface.

Existing assets without claim/kit lineage retain age-based labels and are
explicitly outside evidence-based coverage until linked. Do not invent claim
relationships from filenames or backfill “current” status. Reviewed uploads
support this RFC; authenticated recapture is optional through RFC 007.

## Technical design: dependency indexing and review fences

Apply the [shared source-fence and job contracts](../release-readiness-technical-contracts.md).
RFCs 003/004 already block new approved actions when pinned source sequences
change. This RFC adds the indexed explanation, human resolution workflow and
bounded monitoring; delivery safety must not depend on queue latency.

### Graph representation and indexes

The graph is acyclic by type, with immutable version nodes:

```text
evidence source -> evidence version -> claim version -> artifact revision
                -> screenshot asset revision --------> artifact revision
artifact revision -> kit revision -> handoff intent -> delivery receipt
qualification revision ----------------> kit revision
```

Store direct typed relations in the preceding RFC tables, plus a materialized
reverse-dependency index for traversal. Never infer an edge from a filename,
matching claim text or an LLM response. Build/update edges in the same
transaction that creates the corresponding version or freezes a kit.

| Proposed relation | Fields | Constraint / access path |
| --- | --- | --- |
| platform_material_dependency | Org, source node kind/ID/version, dependent kind/ID/version, relation type | Unique complete edge; indexes `(org, source-kind, source-ID, source-version)` and reverse dependent key; typed FK validation. |
| platform_source_change | Source, sequence, previous/new evidence version, reason, detection time, provider-event key, compare-policy version | Unique org/source/sequence and provider-event key; sequence allocated under source-head lock. |
| platform_freshness_finding | Change ID, affected kit/artifact, reason, priority, owner, state, version, first/last observed time | Unique org/change/affected-node/reason; queue index org/state/owner/created-at/ID. |
| platform_freshness_resolution | Finding, expected version, human action/reason, exact affected hashes, evidence/verification references | Append-only; session decision; same-org references. |
| platform_freshness_revalidation | Kit revision/hash, source ID, acknowledged sequence, reviewed claim versions/support hashes, human approver, reason | Immutable; unique org/kit/source/sequence; never edits original manifest or approval. |
| platform_freshness_scan | Source, cursor/ETag, next check, failure count, lease, budget period, last success | Unique org/source; index due time; last attempted and successful observation separate. |
| platform_freshness_fanout | Change, graph cursor, visited count, state, retry info | One logical fanout per change; progress committed with each finding batch. |

Avoid unconstrained polymorphic foreign keys. Use typed junction tables for
known node pairs or enforce node-registry ownership with composite keys and
type checks. The first implementation can traverse existing claim-support,
kit-member and receipt relations using indexed joins; a general-purpose graph
database is unnecessary. A coverage audit checks that each frozen kit's source
pins equal its complete transitive source set.

### Change classification and synchronous authorization

| Observation | Stored classification | New approved use |
| --- | --- | --- |
| Same reviewed bytes and same normalization version | UNCHANGED observation; no material change event | Existing gates still apply; not proof of unobserved product behavior. |
| Different exact text/image/rollout evidence | MATERIAL_CHANGE pending review | Source sequence advances immediately; pinned kits block. |
| Known formatting-only difference | COSMETIC observation with before/after hashes | Does not block only when deterministic normalization proves reviewed content/selectors unchanged. |
| Timeout, 429 or provider outage | FETCH_FAILED observation | Preserve last good evidence; show failed monitoring, retry within budget. |
| Confirmed access loss, tombstone or source withdrawal | SOURCE_UNAVAILABLE / WITHDRAWN | Advance fence; affected approved actions block. |
| Human reports potential factual error | SUSPECTED_CONFLICT with cited dependency | Advance that dependency's fence pending review; no model truth verdict. |
| Review age exceeds policy | REVIEW_OVERDUE | Warning by default; blocking only under an explicitly configured policy. |

Normalization v1 for text uses the RFC 003 extractor, Unicode normalization,
line-ending normalization and removal of explicitly identified source chrome.
Do not remove numbers, negation, dates, qualifiers or arbitrary whitespace
inside code/tables. Persist raw and normalized hashes and normalization version.
A normalization-version change requires a controlled comparison/backfill; it
cannot classify every source as changed or silently clear existing findings.
Screenshots use exact bytes plus dimensions/recipe/environment metadata first;
perceptual differences may prioritize review but cannot certify semantic safety.

```text
source-change transaction:
  lock source head; verify dedupe key and provider version ordering
  append new evidence/observation; increment sequence if material/unavailable
  insert source-change + outbox event; commit

approval/export/attempt transaction:
  load kit's complete source-pin set
  lock current source heads, then release aggregate and kit
  compare each head sequence with pinned or explicitly revalidated sequence
  if any uncovered sequence / unavailable source / withdrawn fact: block
  otherwise continue through all other readiness and authority checks
```

No per-kit asynchronous update is required to close this race. A source can
affect thousands of kits; advancing one source row fences them immediately.
A missing dependency index or incomplete source-pin closure is a validation
failure and blocks freezing/approval, not an assumption that no source exists.
Existing release/spec/surface-update and asset-delete commands must emit this
protocol; testing only the new monitor endpoint would miss compatibility gaps.

### Fanout worker and review resolution

The outbox starts one logical fanout job per source change. Traverse reverse
edges in batches of 200 ordered by stable IDs, persisting cursor and findings
in one transaction. Use unique finding keys to make replay harmless. Stop
each activity after 30 seconds or 5,000 examined edges, then checkpoint and
continue. Bound total work per workspace per minute through existing job
quotas; do not truncate the graph and mark the change fully processed.

Findings transition OPEN → IN_REVIEW → RESOLVED, with REOPENED only as a new
finding/version after a new cause or invalidated resolution. Multiple affected
artifacts may be grouped in the UI but keep exact per-cause records. A worker
can propose a resolution; only a session-authorized reviewer can decide it.

| Human action | Required effect |
| --- | --- |
| CONFIRM_STILL_VALID | Review new evidence and unchanged claim text/qualifiers, record fresh support decision, then require kit-approver revalidation of the exact unchanged manifest. |
| REPLACE_EVIDENCE | Create a new evidence/support decision under 047; block until every affected claim is verified and exact kit reuse is revalidated or a replacement kit is approved. |
| REVISE_MATERIAL | Create new claim/artifact/kit revisions; follow 047/049 approval and 050 correction handoff. Original material remains historical. |
| WITHDRAW | Record confirmed invalid/withdrawn dependency; block new output, list affected deliveries and require explicit correction/retraction actions. |
| DISMISS_NOISE | Allowed for warning-only/duplicate findings with reason; cannot clear a material source fence or a withdrawn claim. |

Revalidation is an additional human approval record, not mutation of the old
manifest/source pins. It binds exact artifact bytes, current qualification,
claim hashes, replacement evidence/support decisions and acknowledged source
sequences. Fact-review authority verifies the support; kit-approval authority
authorizes reuse (one person may hold both). Extend RFC 004's evaluator to
apply the latest applicable revalidation for each source, rechecking authority
and hashes. A later sequence invalidates it. If artifact text, rollout
qualifiers or audience scope must change, revalidation is prohibited: create
and approve a new kit revision. There is no generic “ignore blocker” action.

Resolution locks source heads, release and finding rows, compares expected
finding/aggregate revisions and commits decision plus outbox once. A newer
source change during review returns 409 rather than acknowledging unseen
evidence. Resolving a finding does not mark old remote material corrected;
correction delivery remains a separate RFC 005 receipt per destination.

### APIs, polling budgets and implementation gates

Proposed public endpoints under `/api/v1`:

| Endpoint | Contract |
| --- | --- |
| POST /releases/{id}/freshness-reports | Expected revision, exact claim/evidence/artifact reference, reason and human observation; creates deduplicated source change/finding. |
| GET /freshness-findings | Owner/state/release filters and cursor; return coverage and blocked-action reasons. |
| GET /freshness-findings/{id}/impact | Exact version path through claim/artifact/kit to receipts; private evidence only under review permissions. |
| POST /freshness-findings/{id}/resolutions | Expected finding/aggregate revisions, action, evidence/verification references, source sequence and rationale. |
| POST /kits/{id}/revisions/{version}/revalidations | Human kit approver, exact manifest hash, reviewed support set and dependency token; no content mutation. |

Start manual/event-driven. Optional polling defaults to daily checks with
jitter, at most 20 registered sources per organization per day, two fetches
concurrently, 15-second fetch deadlines, 2 MiB compressed/decompressed body
limits and RFC 003's retained text bounds. Enforce SSRF/redirect policy at
each hop. Honor ETag/Last-Modified but treat 304 only as a transport observation.
Use the provider's Retry-After; otherwise back off 5 minutes, 30 minutes, then
the next scheduled window. Suspend on confirmed revoked access until repaired.
Budget exhaustion defers checks visibly; it never marks evidence current.

Findings are visible immediately when materialized. Send at most one digest
notification per owner/release/day for routine findings; critical withdrawal
may notify once per cause. Persist notification receipts and honor workspace
preferences. Notification failure cannot undo the source fence. Do not attach
confidential evidence content to notification payloads.

| Test | Required invariant |
| --- | --- |
| Source changes while fanout worker is stopped | Export/handoff blocks immediately from source-head comparison. |
| One source feeds two releases and 1,000 artifacts | Complete cursor traversal, bounded work and deduplicated findings; unrelated source kits stay eligible. |
| Crash before/after a fanout batch commit | Replay produces no duplicate finding or skipped dependency. |
| Timestamp/format noise, negation change, numerical change | Only proven cosmetic changes suppress blockers; material content differences remain reviewable. |
| Timeout vs 403 vs tombstone vs 30-day-old capture | Distinct states; deletion/revocation blocks, age is policy-driven, failure does not assert contradiction. |
| Human revalidates while a newer source revision arrives | Stale decision conflicts; unchanged bytes can be reused only with exact current support and human reapproval. |
| Imported legacy asset with no lineage | Coverage incomplete, never silently reported as monitored/current. |
| Correction after remote human edits | New approved correction and separate per-destination receipt; original approval and delivery remain intact. |

## Acceptance criteria

1. Changing a linked rollout fact or screenshot identifies the exact affected
   claims, kit revisions and destination receipts without touching unrelated kits.
2. A repeated event or poll produces one actionable finding per cause, and a
   reordered claim list does not produce a false product-change finding.
3. A missing source, an old screenshot and a confirmed contradiction have
   distinct visible states and do not silently become confirmed truth/falsehood.
4. A material change blocks a new approved handoff until review; old approvals
   and remote deliveries remain inspectable and are not silently rewritten.
5. A human can confirm validity, replace evidence, request a new kit revision
   or withdraw material, with actor/time/reason and concurrency protection.
6. An approved correction can follow RFC 005 to each affected destination,
   respecting remote edits and preserving the previous receipt.
7. Tenant isolation, revoked source access, deleted content, job retries and
   cost limits are tested; unlinked legacy assets show incomplete coverage.
8. A controlled two-release pilot demonstrates discovery, review, correction
   and downstream handoff before scheduled checking is broadly enabled.

## Observability

Time from a confirmed material change to resolved affected communications is
the primary metric. Track false-positive findings, owner review effort,
coverage of linked materials, unresolved critical findings and cost. A larger
alert volume does not demonstrate better freshness.

## Rollout and rollback

Ship manual and event-driven findings first, then bounded scheduled checks
for customers with repeat kit use. Disabling monitoring stops new checks and
notifications while retaining open findings and delivery blocks already
established by review. It never marks existing findings resolved automatically.
