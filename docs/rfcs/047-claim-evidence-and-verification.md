# RFC 047: Claim Evidence and Human Factual Verification

**Status:** Proposed
**Date:** 2026-10-23
**Owners:** Product Engineering
**Depends on:** RFC 006, RFC 012, RFC 019, RFC 046
**Execution:** Milestone 1 in the [RFC execution order](README.md)

## Decision

Extend versioned release specs with stable claims, versioned evidence and
human verification decisions. Keep citation validation, but make its limit
explicit: a known source ID does not prove the source supports the claim.
An AI model may propose evidence and flag conflicts; only an authorized human
can verify a material product claim.

## Existing foundation

[Spec schemas](../../lib/launch/spec-schema.ts) include limitations, FAQs,
open questions and source excerpts. [Citation checks](../../lib/launch/citations.ts)
validate source IDs, while [copy guards](../../lib/launch/guards.ts) validate
claim references. [Launch persistence](../../services/internal/product/launch.go)
stores and approves versions. Extend these seams instead of replacing the
pipeline or treating a source-fetch success as verification.

## Proposed data and trust contract

```text
Evidence version
  workspace, release, source identity, source kind, access classification
  URL/provider revision or human-authored attestation identity
  retrieval time, content hash, retained supporting passage or image version
  retrieval outcome, limitations, retention/tombstone metadata
Claim version
  stable claim ID, spec version, exact text, audience and rollout qualifiers
  linked evidence versions and supporting spans/regions
  assessment: unresolved, supported, contradicted, withdrawn
Verification decision
  claim version, evidence versions, human actor, timestamp, rationale
  expected facts revision; supersedes previous decision if applicable
```

Keep provider permissions and workspace isolation when fetching or displaying
sources. A private PR is not a public citation merely because it has a URL.
Exports use audience-safe explanations and approved excerpts; internal source
URLs and sensitive screenshots are excluded from customer materials unless
explicitly cleared. The private review manifest retains the traceability.

The brief can support a claim only as a named, dated human attestation with a
recorded rationale; model-generated briefs must not recursively verify
themselves. Capture unavailable sources as unavailable. Contradictory passages,
missing availability conditions and unsupported numerical benefits stay
unresolved until a reviewer edits, excludes or resolves them with evidence.

## First slices

1. Add evidence snapshots and stable claim IDs to new spec versions, with a
   migration adapter from section/index references. Persist the mapping; never
   remap an old reference onto a different claim after a list reorder.
2. Add a manual review surface showing exact claim, supporting passage/image,
   source date/revision and unresolved questions. No new model is required.
3. Record per-claim decisions in the backend. Draft generation may use
   unresolved claims with visible warnings, but they cannot enter an approved
   kit. Model-generated summaries and screenshots require the same review.
4. Add optional bounded model assistance to suggest support or contradiction.
   Reuse source sanitization, fetch limits, run accounting and metering. Model
   output never writes a human verification decision.

Changes to claim text, rollout/audience qualifiers or evidence content produce
new versions and invalidate the affected verification. A new unrelated claim
need not invalidate all unchanged claim decisions, but kit readiness must be
recomputed. Failed refreshes do not prove an old claim false.

## Architecture and migration

Store proposed evidence/claim/decision records with organization scope in Go/Ent;
version and authorize writes in the backend transaction. Add contracts and SDK
operations rather than letting the web write data. Existing approved specs
remain historical approvals and are marked unverified for the new kit workflow
until reviewed. Preserve old claim paths in compatibility reads.

Keep bounded excerpts or approved snapshots with hashes; a hash alone is not
reviewable evidence. Retention and deletion may remove source content while
leaving minimal permitted tombstones. Mark affected verification unavailable
and require review; never keep deleted confidential content in an audit payload.

## Acceptance criteria

1. A real source ID pointing to an irrelevant passage cannot yield a verified
   claim without an explicit human support decision; this is covered by a
   reviewer-labeled fixture set with unsupported and contradicted examples.
2. Private, unreadable, changed and instruction-bearing sources remain
   distinguishable. Repository text cannot set approval or delivery authority.
3. A human attestation names its author, time and scope; an AI-authored brief
   cannot become its own evidence through a citation loop.
4. Reordering or editing claims preserves identity/history and invalidates
   only the relevant decisions; stale/concurrent decisions are rejected.
5. Verified facts pin exact claim/evidence versions, and an API key, worker or
   agent cannot record a human verification decision.
6. Cross-workspace reads and references fail, audience-safe export rules hold,
   and deletion removes source content without fabricating continued support.
7. Existing specs migrate as unverified without losing their historical
   approvals; ordinary draft generation remains available during rollout.

## Observability

Substantive factual corrections after delivery is the primary quality outcome,
using RFC 045's cohort definition. Also measure reviewer effort and unresolved
claims. Citation coverage alone is not a factual-accuracy score.

## Rollout and rollback

Start with manual review on a pilot cohort and compare reviewer decisions with
the assisted baseline. Add model assistance only if it reduces review effort
without increasing corrections. A feature switch can stop new assistance;
retain versioned evidence and decisions, and never bypass verification to
recover a failing generator.
