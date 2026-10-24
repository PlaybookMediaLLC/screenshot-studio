# RFC 002: Qualified Releases and Accountable Fact Intake

**Priority:** 002 — Active delivery
**Previous ID:** 046 ([renumbering map](renumbering-2026-10-24.md))
**Status:** Proposed
**Date:** 2026-10-23
**Owners:** Product Engineering
**Depends on:** RFC 001
**Reuses:** RFC 015, RFC 011, RFC 016
**Execution:** Milestone 1 in the [RFC execution order](README.md)

## Decision

Extend the existing Release and source-event workflow with a human-owned
qualification step. A source event suggests work; a release owner decides what
the change means, whom it affects and whether it needs communication. A merged
PR or successful deployment is evidence, not proof of general availability.

## Existing foundation

The [release schema](../../services/ent/schema/release.go) stores a brief,
sources, screenshots and status. [GitHub intake](../../services/internal/product/github_events.go)
collects merged changes and releases. The
[automation classifier](../../services/internal/product/release_automation_relevance.go)
already judges customer relevance, and Temporal runs accepted workflows.
Reuse these operations instead of building another webhook service or classifier.

## Proposed contract

Add a revisioned qualification record owned by the Go backend and linked to
the existing release. The names below are proposed data, not current fields:

```text
release + qualification revision
  source event IDs / repository / commit or deployment IDs
  grouped changes and merge/split history
  accountable owner and fact reviewer
  externally meaningful decision + rationale
  affected audiences / required materials / communication scope
  rollout state: unknown, planned, limited, general, withdrawn
  availability conditions, exclusions and limitations
  owner-confirmed release-ready time
  decision: needs facts, qualified, no communication, deferred
  deciding human, time and expected prior revision
```

Unknown values stay unknown. The owner must confirm rollout and exclusions
before kit approval; this intake can save incomplete drafts. Model confidence
and an AI recommendation never fill the human decision fields.

## Flow and boundaries

1. First ship manual selection of an existing release, sources and uploaded
   evidence. Require no repository connection for this slice.
2. Show a qualification form with missing facts, owner, audience and rollout.
   “No communication” and “defer” are legitimate persisted outcomes.
3. Connect existing GitHub/deployment suggestions to the same form. Deduplicate
   by workspace, source and provider event identity; replay returns the original
   result. Group PRs and deployments under one release with a reviewable reason.
4. A human can merge or split candidates. Retain lineage and a canonical release
   identity so adoption metrics do not increase merely because events multiply.
5. Add a facts review handoff. Qualification permits draft preparation, not
   approval, scheduling or delivery. RFC 003 verifies claims; RFC 004 gates kits.

Historical backfills remain suggestions and preserve the existing no-action
behavior. Requalification creates a revision and marks downstream readiness
for re-evaluation. Do not archive or rewrite existing campaigns. Existing
automation can continue to create drafts; a new kit cannot treat those drafts
as human-qualified by default.

## Architecture and migration

Add organization-scoped Ent data and additive SQL migrations. Expose Zod
contracts, Go domain operations and SDK access through the existing API
boundaries. Human decisions use backend session authority; API keys and agents
may submit evidence or prepare drafts within their existing scope but cannot
impersonate a reviewer. Enforce ownership for every referenced source and asset.

Backfill old releases as unreviewed, with their existing source associations.
Do not infer confirmation from Release READY, a prior campaign approval or an
AI classification. Use expected revisions for writes and audited decisions.

## Technical design: persistence and commands

Apply the [shared transaction and API contracts](../release-readiness-technical-contracts.md).
The following relations and endpoints are proposed additions. Qualification is
a separate state machine: existing Release DRAFT/READY/ARCHIVED/CANCELLED
values do not express factual qualification and must not be reused as if they do.

### Tables and invariants

| Proposed table | Fields beyond shared org/ID/timestamps | Constraints and indexes |
| --- | --- | --- |
| platform_release_readiness | Aggregate revision, current qualification pointer, first qualification time, canonical state, optional merged-into release | One per org/release; same-org release FK; current qualification belongs to this release. |
| platform_release_qualification | Release, version, parent revision, owner, fact reviewer, rationale, rollout, availability, exclusions, ready time, requirement JSON, author | Unique org/release/version; immutable payload; required revision/author fields; JSON schema version. |
| platform_release_qualification_decision | Qualification revision, decision, human user/session reference, reason, decided time | Immutable; one final decision per qualification revision; actor was authorized and assigned at decision time. |
| platform_release_source_binding | Provider connection, object kind, provider object ID, current canonical release, first/last event sequence | Unique org/connection/object-kind/provider-object-ID; index org/release. |
| platform_release_source_observation | Binding, provider event identity, source version/hash, received time, metadata reference | Unique org/connection/provider-event-ID; delivery ID differs from the durable PR/deployment object identity. |
| platform_release_lineage | Operation MERGE/SPLIT, source/destination release IDs, moved binding IDs, reason, actor | Immutable; same-org FKs; index each release and operation time. |

The requirement JSON is a versioned array of stable audience IDs and required
material kinds. Start with SALES, CUSTOMER_SUCCESS and CUSTOMER plus an
explicit OTHER label; preserve IDs when labels change. Material kinds are
FACT_SHEET, SALES_NOTES, CS_NOTES, ANNOUNCEMENT, FAQ and SCREENSHOT. An owner
can record a justified omission, but approval later evaluates it explicitly.
Bound intake to 20 audiences, 50 material requirements and 200 source bindings
per command; return 400 instead of silently truncating.

Store unknown facts as null or UNKNOWN, never empty strings interpreted as
confirmed. Rollout is UNKNOWN, PLANNED, LIMITED, GENERAL or WITHDRAWN. LIMITED
requires eligibility conditions. All communication decisions require owner,
fact reviewer, a reason and at least one source or named human brief. QUALIFIED
also requires a nonempty audience/material scope, a non-UNKNOWN/non-WITHDRAWN
rollout and an availability statement, including an explicit statement when
there are no exclusions. A planned release may lack an actual ready time;
preserve that null for metrics and require a planned-availability qualifier.

### State transitions

Draft content is immutable per revision; editing creates the next NEEDS_FACTS
revision. The current pointer determines effective state, while old decisions
remain queryable. QUALIFIED permits preparation and does not imply a kit is ready.
Effective state is the current revision's final decision, or NEEDS_FACTS when
no decision exists. Do not write a decision by mutating the immutable facts row.

| Current effective state | Command | Result / prerequisite |
| --- | --- | --- |
| None | Create draft | NEEDS_FACTS at version 1. |
| NEEDS_FACTS | Qualify | QUALIFIED after completeness and assigned human authority checks. |
| NEEDS_FACTS | Decline communication | NO_COMMUNICATION with reason; no draft-generation dispatch. |
| NEEDS_FACTS | Defer | DEFERRED with reason and optional revisit time; no automatic later qualification. |
| QUALIFIED, DEFERRED, NO_COMMUNICATION | Revise/reopen | New NEEDS_FACTS revision; prior decision remains historical. |
| Any active state | Withdraw | New WITHDRAWN decision/revision; block new kit approval/export/handoff. |
| WITHDRAWN | Reopen | New NEEDS_FACTS revision with reason and current human authority. |
| Any | Repeat same command key/body | Original response; no second decision, timestamp or outbox event. |

Editing a release's factual brief, rollout or qualification source set through
an older endpoint must also advance the readiness aggregate and mark the
current qualification as requiring review. Add this bridge to existing release
updates; do not rely on clients remembering to call the new endpoint. Cosmetic
display-title edits may remain non-invalidating only when the title is not a
pinned factual artifact. Make the field classification explicit in tests.

### Endpoint contracts

Public prefix below is `/api/v1`; the backend owns all validation.

| Method and path | Request | Result |
| --- | --- | --- |
| GET /releases/{id}/qualification | None | Current revision, decision, missing fields, canonical ID, aggregate revision. |
| POST /releases/{id}/qualification/revisions | Expected revision plus editable facts, assignments, source IDs and requirements | 201 immutable revision; actor fields ignored/rejected from body. |
| POST /releases/{id}/qualification/decisions | Expected revision, qualification revision ID, decision and reason | Human-only decision and new aggregate revision; 409 on outdated pointer or incomplete qualification. |
| POST /releases/{id}/qualification/merge | Source release IDs with expected revisions, surviving ID, binding selection, reason | Canonical release plus lineage; all references in the authenticated org. |
| POST /releases/{id}/qualification/split | Expected revision, disjoint binding groups, new release briefs and reason | New draft releases, retained source release and lineage. |

Example decision; IDs below stand for validated CUIDs:

```json
{
  "expectedRevision": "12",
  "qualificationRevisionId": "<qualification-revision-id>",
  "decision": "QUALIFIED",
  "reason": "Owner confirmed limited rollout to the named beta cohort."
}
```

A response includes qualification version, aggregate revision, first qualified
time, canonical release ID and decision actor/time. Missing-fact errors contain
field paths and stable reasons such as OWNER_REQUIRED, ROLLOUT_UNKNOWN and
AUDIENCE_REQUIRED. A DEFERRED reminder may create a task, never a decision.

### Event identity, merge and split transaction

Distinguish a provider delivery ID from the durable source object. Two webhook
deliveries about the same PR update one binding; two deployments from the same
commit remain separate observations and may share a candidate only after
explicit grouping. Include connection/repository identity in keys to avoid
cross-repository number collisions. Out-of-order observations remain in
history; monotonic provider version/time checks prevent an old event from
replacing a known newer source snapshot. When order is unknown, preserve both
and surface the conflict rather than invent chronology.

Candidate creation inserts the source binding and candidate release in one
transaction. The unique binding key resolves concurrent duplicate intake;
the loser reloads the existing binding. Existing historical replay remains
non-actionable unless a human explicitly selects it.

Merge/split are restricted to releases that have never been human-qualified
and have no approved kit or delivery. This keeps the cohort identity stable;
later related releases are linked as related work instead of rewriting
delivered history. Lock every participant aggregate and binding in the shared
order; reject duplicate groups, cycles, already merged targets and foreign
bindings. For merge, move bindings to the selected survivor, mark other roots
MERGED, write lineage and reset the survivor to NEEDS_FACTS. For split, create
new roots, move only the selected disjoint binding sets and record lineage.
Every resulting release remains unqualified. No source observation is deleted.

Reads of a merged release return its canonical ID and history. Writes to an
alias return 409 CANONICAL_RELEASE_CHANGED; they are not silently redirected.
If later pilot research needs post-qualification merges, it requires an explicit
metric-restatement design rather than relaxing this invariant casually.

### Implementation slices and tests

Start with manual draft/decision tables and UI; then add source bindings and
event-assisted selection; then add merge/split. Extend the existing
[release model](../../services/ent/schema/release.go),
[source-event operations](../../services/internal/product/github_events.go) and
[HTTP release adapter](../../services/internal/httpapi/releases.go) through new
platform operations. Backfill readiness roots lazily or in resumable batches;
historical releases have no first-qualified timestamp until a real decision.

| Test | Expected invariant |
| --- | --- |
| Two decisions with the same expected revision | One commits; one gets 409; one outbox event and first-qualified timestamp. |
| Duplicate PR deliveries, reordered updates, equal PR number in two repositories | One binding per source object; preserved observations; distinct repository identities. |
| Direct Go/MCP/API-key attempt to qualify | 403 even with a valid release-creation scope. |
| Merge vs qualification or two overlapping splits | Aggregate locks serialize; post-qualification merge fails; no orphan or duplicated binding. |
| Existing brief-update endpoint after qualification | Qualification needs review and new approved output is blocked. |
| Backfill and rollback | Historical campaign/spec approvals unchanged; no generated send or invented qualification event. |

## Acceptance criteria

1. A manual release can be qualified without GitHub, a social account or AI.
2. Duplicate/reordered source events map to the same candidate and preserve
   source evidence; concurrent submissions do not create duplicate releases.
3. An internal refactor can be explicitly declined without creating content;
   a meaningful change can remain deferred pending rollout facts.
4. Grouping multiple PRs/deployments preserves lineage, and merge/split actions
   keep metric identities reconcilable rather than double-counting a release.
5. Missing audience, owner or rollout information is visible and cannot be
   interpreted downstream as human confirmation.
6. Stale writes conflict, cross-workspace references fail, and only an
   authorized human can record the qualification decision.
7. Backfill and existing automation produce no implicitly approved kits or
   new external sends.

## Observability

Time from selected change to human qualification is the primary operational
metric. Report declined/deferred reasons and the share of AI suggestions
overturned by owners. Count one release rather than each underlying event.

## Rollout and rollback

Enable the manual form for the pilot cohort, then connect existing event
suggestions. Keep the feature additive; disabling it stops new qualification
automation while preserving records and ordinary release editing. Validate
replay, merge/split, tenant isolation and revoked membership in integration
tests before enabling event-assisted intake.
