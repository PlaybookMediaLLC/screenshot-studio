# RFC 004: Role-Specific Release Kits and Readiness Gates

**Priority:** 004 — Active delivery
**Previous ID:** 049 ([renumbering map](renumbering-2026-10-24.md))
**Status:** Proposed
**Date:** 2026-10-23
**Owners:** Product Engineering
**Depends on:** RFC 002, RFC 003
**Reuses:** RFC 011, RFC 020, RFC 019, RFC 012, RFC 013
**Execution:** Milestone 2 in the [RFC execution order](README.md)

## Decision

Add a versioned release-kit manifest linking verified facts to the actual
materials each audience needs. A kit is ready only when a backend evaluation
and an authorized human approve the exact versions being delivered. Reuse
existing release specs, drafts, creative documents, assets and approval
authority. Do not force sales/CS materials into a social-channel enum or
require a campaign, connected social account or chat session to complete a kit.

## Existing foundation

[Release specs and campaign plans](../../server/ent/schema/launch.go) already
have versions and approval records. [Content drafts](../../server/internal/product/content_drafts.go)
and [creative sets](../../server/ent/schema/platform_creative_set.go) provide
editable material; [launch decisions](../../server/internal/product/launch.go)
and [campaign transitions](../../server/internal/product/campaign_transitions.go)
provide human authority and state-machine precedents. Extend those boundaries
with a kit-level relation and evaluation.

## Proposed model

```text
Release kit revision
  workspace + canonical release + qualification revision
  approved facts/spec revision and verified claim/evidence versions
  manifest: artifact ID + immutable revision/hash + audience + required flag
  readiness evaluation version, blockers and reviewer assignments
  human approval actor/time + exact manifest hash
Artifact
  kind: fact sheet, sales notes, CS notes, announcement, FAQ, screenshot,
        optional email/social variation
  native draft/design/asset reference + claim links + access classification
  draft/review/approved/superseded history
```

Link existing content rather than copying mutable pointers and calling them
approved. Snapshot mutable drafts into immutable artifact revisions for review
and export. Each factual passage and material screenshot has claim/evidence
links. Record unsupported or newly introduced claims as blockers. Templates
must retain rollout conditions and limitations when adapting language.

## Readiness evaluation

Evaluate deterministically in the Go domain service against the exact manifest
and current authority. A readiness result explains each blocker and its owner.

| Check | Blocking condition |
| --- | --- |
| Qualification | Missing accountable owner, undecided communication scope, unconfirmed rollout/availability or withdrawn release. |
| Facts | A material included claim is unresolved, contradicted, withdrawn, or verified against a different claim/evidence version. |
| Materials | Required audience/material missing, empty, inaccessible, out of revision, or lacking required evidence links. Explicit omissions need an owner and reason. |
| Content review | Reviewer has not confirmed that all material assertions are represented and supported; generation having valid refs is insufficient. |
| Screenshots | Unreviewed source/crop/redaction, wrong product state or missing usage permission. Uploaded images use the same review requirement. |
| Audience safety | Customer-facing output contains uncleared private sources, sensitive data or internal-only language. |
| Final decision | Missing human approval of this exact manifest, revoked decision authority, or intervening dependency edit. |

No AI score overrides these checks. Permit draft generation and preview with
visible unresolved issues. Block exports represented as approved and all
approved handoffs until ready; an explicitly watermarked draft preview remains
possible for reviewers. Unsupported facts cannot be waived into truth: remove
them, resolve them, or record an eligible human attestation under RFC 003.

The readiness service is called by the UI, SDK/API and agent entrypoints, and
again when creating an export/delivery job. Pin immutable inputs transactionally
with the authorization decision. Recheck revocation and withdrawal before an
external action. A concurrent edit creates a new revision rather than altering
the approved bytes. Preserve historical approvals, but stop new delivery of a
superseded or withdrawn revision until an explicit permitted decision.

## Incremental implementation

1. Manual kit assembly from existing drafts and media, with a single fact
   reviewer and kit approver. One person may hold both authorized roles during
   pilots; record the two decisions separately.
2. Templates for fact sheet, sales/CS notes, customer announcement and FAQ
   generated from the verified facts. Selectively regenerate one artifact;
   keep other edits and versions intact.
3. Add readiness review and one approved ZIP export containing audience-safe
   Markdown, image files and a version manifest. Keep private evidence in an
   authenticated review view, separate from the customer-facing bundle.
4. Connect the approved manifest to RFC 005's destination handoffs. Reuse
   existing social publishing only for requested, separately approved variants.

## Migration and compatibility

Use additive Go/Ent tables, migrations, Zod contracts and SDK methods.
Existing campaigns, Story Sets and drafts remain usable. Import them as draft
kit candidates with their source IDs/revisions; no historical campaign status
automatically certifies a new kit. Do not introduce a new renderer, editor,
scheduler or broad approval-policy engine as a prerequisite.

## Technical design: immutable review and export

Use the [shared contracts](../release-readiness-technical-contracts.md) for
authorization, canonical hashes, lock order and source fences. The following
relations and operations are proposed. Readiness is a computed predicate over
specific versions; a stored APPROVED label alone never authorizes output.

### Tables and immutable snapshot boundary

| Proposed table | Fields | Constraints / indexes |
| --- | --- | --- |
| platform_release_kit | Release, current draft revision, current approved revision, reviewer assignment | One primary kit per canonical release initially; same-release pointers. |
| platform_release_kit_revision | Kit, version, qualification revision, state, manifest JSON/hash, freeze job, prepared time | Unique org/kit/version; immutable manifest once REVIEWABLE; manifest schema version required. |
| platform_kit_artifact_revision | Release, kind, audience, access class, native source ID/version, document snapshot, snapshot hash, rendered object/hash, claim-map hash | Immutable once prepared; native source is provenance, not a live render pointer. |
| platform_kit_artifact_claim | Artifact revision, document node/region ID, claim version, support/verification reference | Same-release claim FK; index claim-version/artifact-revision; preserve material assertion coverage. |
| platform_kit_member | Kit revision, artifact revision, audience, requirement ID, display order | Unique org/kit-revision/requirement/artifact; membership is immutable after freeze. |
| platform_kit_source_pin | Kit revision, underlying source ID, acknowledged sequence, evidence-version hash | Unique org/kit-revision/source; complete flattened dependency closure for synchronous readiness checks. |
| platform_kit_review_decision | Kit revision, review type, manifest hash, actor, reason, decision, evaluated policy version, source token | Append-only; review types CONTENT_COVERAGE and FINAL_APPROVAL are distinct. |
| platform_kit_export | Kit revision, audience scope, export schema version, bundle object/hash, file index, state | Unique org/kit-revision/audience-scope/export-version; persisted bytes reused on retry. |

The existing [content draft revision](../../server/ent/schema/content_draft_revision.go)
is saved at most every ten minutes during editing and on scheduling. Therefore
the latest autosave may be behind the visible document. Freeze must snapshot
the current persisted draft transactionally after the editor has acknowledged
its final save. Require expected native document revision/hash; conflict if
the server document changed. Unsaved local/collaborative changes cannot be
silently approved. Lock the persisted draft/creative document while copying
its JSON and collect every referenced asset/version in the same transaction.

Reuse existing immutable creative-set versions where sufficient, but resolve
fonts, background assets, crops and redaction outputs into pinned references.
Reject external live image URLs in a reviewable snapshot; import approved
bytes first. A native editor change later produces a new artifact candidate,
not a mutation of a reviewed snapshot. Declare replacement through a new kit
revision, making the previously selected revision ineligible for new sends
until the replacement is reviewed. An unrelated scratch draft does not revoke
historical approved bytes.

### Manifest and preparation protocol

```json
{
  "schemaVersion": 1,
  "releaseId": "<canonical-release-id>",
  "kitRevisionId": "<kit-revision-id>",
  "qualificationRevisionId": "<qualification-revision-id>",
  "requirementRevision": "3",
  "artifacts": [{
    "artifactRevisionId": "<artifact-revision-id>",
    "audienceId": "sales",
    "kind": "SALES_NOTES",
    "classification": "INTERNAL_MATERIAL",
    "snapshotSha256": "<document-hash>",
    "outputSha256": "<rendered-markdown-hash>",
    "claimMapSha256": "<claim-map-hash>"
  }],
  "omissions": [],
  "sourcePins": [{ "sourceId": "<source-id>", "acknowledgedSequence": "2" }],
  "rendererVersion": "<pinned-exporter-version>"
}
```

The internal manifest contains claim/evidence lineage. Build a separate public
file index containing only approved audience-safe file names/hashes and release
metadata; do not serialize private source IDs, URLs, review notes or signed
storage URLs into customer bundles. Reject duplicate/absolute/traversal file
names and executable/unsupported embedded content. First-slice limits are
50 artifacts, 1 MiB document JSON per artifact and 100 MiB total bundle.

Freeze has two phases. First, lock and snapshot owned native inputs, record
BUILDING plus a render job, then commit. Second, render outside the transaction
with pinned exporter/font/asset versions, store content-addressed outputs and
record hashes/receipts. Finalization locks the source heads and aggregate,
checks the original expected inputs and complete outputs, computes the
canonical manifest, and moves BUILDING to REVIEWABLE. If inputs were replaced
or access changed during rendering, retain the candidate as needing review
or failed; it cannot automatically become approved.

Human approval covers the bytes prepared before review. Export packaging after
approval uses only those stored outputs. Do not rerender approved HTML/design
against current fonts, external assets or a newer renderer. ZIP entries have
stable sort order, safe UTF-8 paths, fixed timestamps/permissions and fixed
compression settings; cache the resulting bundle/hash. If a lost acknowledgment
requires retry, return existing bytes or verify the reproduced hash before
making a bundle available. A renderer upgrade creates new candidate outputs.

### Deterministic readiness evaluator

Implement a pure Go evaluator over a loaded snapshot, with database-loading
and authorization wrappers. Inputs are pinned qualification/claim/verification
versions, requirements, artifact coverage decisions, source-head sequences,
access classes, reviewer authority and evaluation-policy version. Output:

```typescript
type Readiness = {
  canApprove: boolean
  canExportApproved: boolean
  canRequestHandoff: boolean
  manifestHash: string | null
  aggregateRevision: string
  dependencyToken: string
  policyVersion: number
  blockers: Array<{
    code: string
    objectId: string
    audienceId: string | null
    ownerId: string | null
    repairAction: string
  }>
}
```

Separate approval eligibility from approved-use eligibility to avoid a circular
gate: a missing final approval does not prevent the human from approving.
It does prevent approved export/handoff. Stable blocker codes include
QUALIFICATION_REQUIRED, AVAILABILITY_UNCONFIRMED, CLAIM_UNVERIFIED,
EVIDENCE_UNAVAILABLE, SOURCE_CHANGED, MATERIAL_MISSING, COVERAGE_UNREVIEWED,
SCREENSHOT_UNREVIEWED, AUDIENCE_LEAK, OUTPUT_INCOMPLETE, APPROVAL_REQUIRED,
APPROVER_REVOKED and REVISION_SUPERSEDED. Sort blockers by requirement/object/code
for stable UI and tests; private details stay in the authorized review view.

An omission satisfies a requirement only when its kind is permitted by the
qualification policy and its reason was explicitly reviewed. It cannot waive
unsupported included assertions. CONTENT_COVERAGE requires a human to confirm
that factual passages, numerical claims, images and qualifiers have claim
links. Syntax checks verify those links and selectors; an LLM cannot attest
that all material assertions were discovered.

Compare the pinned qualification to the current qualified revision and every
included claim to its current non-withdrawn version/decision. An old SUPPORTED
row is insufficient when the same stable claim now has changed text, qualifiers
or a contradictory decision. Unrelated added claims do not force a revision
of unchanged artifact bytes, but changes to required scope still block through
the qualification check. These checks supplement the source-sequence fence.

### APIs and approval transaction

| Proposed endpoint under /api/v1 | Contract |
| --- | --- |
| POST /releases/{id}/kits | Assemble draft with expected aggregate revision, owned native sources, audiences and requirement IDs. |
| POST /kits/{id}/revisions | Create replacement draft; preserve the old immutable revision and decisions. |
| POST /kits/{id}/revisions/{version}/prepare | Expected revision and native source hashes; 202 preparation job. |
| GET /kits/{id}/revisions/{version}/readiness | Current deterministic result; advisory snapshot, not a durable capability to send later. |
| POST /kits/{id}/revisions/{version}/decisions | Expected aggregate revision, manifest hash, dependency token, decision/review type and rationale; human session only. |
| POST /kits/{id}/revisions/{version}/exports | Audience scope, expected manifest hash; re-evaluates approved-use gate and returns 202 job or existing export. |

The final-approval command locks authority, source heads, aggregate and kit
revision in the shared order, reloads inputs, compares expected revision/hash/
dependency token, runs the evaluator, writes approval and advances the
aggregate in one transaction. A source change or withdrawal racing approval
must serialize before or after that commit; no approval of a mixture of
versions is possible. Rejection records a decision and requires a new draft
revision for edits. REVIEWABLE → APPROVED/REJECTED; APPROVED → SUPERSEDED or
WITHDRAWN preserves approval history. BUILDING failures go to FAILED and need
a repaired/new preparation job; a partial output cannot enter REVIEWABLE.

Approved downloads use the authenticated backend asset-delivery boundary and
short-lived access. Recheck current readiness when minting download access;
already downloaded bytes cannot be recalled. Handoff authorization and its
external-send race boundary are specified in RFC 005. Watermarked draft
previews use a separate state/endpoint and never produce an approved receipt.

RFC 006 later adds an append-only revalidation decision for unchanged artifact
bytes with newly reviewed evidence. Until that extension ships, a material
source change requires a new reviewed kit revision. Neither path edits the
original manifest or lets an automatic worker clear a source-change blocker.

### Implementation slices and tests

| Slice | Required technical gate |
| --- | --- |
| Manual assembly + freeze | Current draft differs from its autosave; frozen output matches acknowledged current state. Concurrent editor save causes conflict, never mixed bytes. |
| Claim/audience review | Missing assertion link, incomplete rollout qualifier, private source URL, unreviewed redaction and missing required audience each yield a specific blocker. |
| Final approval | Table-driven evaluator tests plus PostgreSQL approval/edit/revocation races; API key and service principal cannot record human decisions. |
| Approved export | Partial render, lost completion acknowledgment, missing object and changed exporter version cannot return a new hash under an old approval. |
| Compatibility | Existing specs/campaigns import as drafts; no historical approval becomes kit approval; original editor/export workflows still operate. |
| End-to-end | Manual qualify → verify → freeze → reject → revise → approve → export, then source change before another export returns SOURCE_CHANGED. |

## Acceptance criteria

1. A qualified release can become a complete manual kit and approved export
   without a social account, agent, authenticated capture or new canvas work.
2. Each required audience receives the agreed materials, or an explicit
   reviewed omission; all artifacts pin the same facts lineage.
3. Unknown rollout, unsupported claims, unreviewed images and private-source
   leaks block approval/delivery with specific repair actions.
4. Editing facts, copy, screenshots or manifest membership after approval
   requires re-evaluation; concurrency cannot deliver newly edited bytes under
   an earlier approval, and the old approval remains inspectable.
5. Human decisions are enforced by the backend across UI, REST and agent
   calls, with cross-tenant, revoked membership and stale-revision tests.
6. A retry produces the same approved export manifest and content hashes;
   partial render failure is visible and does not label an incomplete kit ready.
7. An end-to-end fixture covers qualify → verify → assemble → reject → revise
   → approve → export, plus a dependency edit immediately before export.

## Observability

Release-to-approval time at a controlled factual correction rate is the primary
operational outcome. Report blocker categories, revision churn, reviewer effort
and artifact omissions; generated document count is not success.

## Rollout and rollback

Pilot manual manifests before enabling generation. Gate the new kit surface
per workspace, and preserve ordinary draft editing if it is disabled. A failed
readiness service fails closed for approved export/delivery; use the explicitly
assisted process with recorded manual approvals rather than silently treating
the kit as automatically ready. Historical approved bundles remain identifiable.
