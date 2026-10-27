# RFC 003: Claim Evidence and Human Factual Verification

**Priority:** 003 — Active delivery
**Previous ID:** 047 ([renumbering map](renumbering-2026-10-24.md))
**Status:** Proposed
**Date:** 2026-10-23
**Owners:** Product Engineering
**Depends on:** RFC 002
**Reuses:** RFC 011, RFC 017, RFC 012
**Execution:** Milestone 1 in the [RFC execution order](README.md)

## Decision

Extend versioned release specs with stable claims, versioned evidence and
human verification decisions. Keep citation validation, but make its limit
explicit: a known source ID does not prove the source supports the claim.
An AI model may propose evidence and flag conflicts; only an authorized human
can verify a material product claim.

## Existing foundation

[Spec schemas](../../clients/apps/web/lib/launch/spec-schema.ts) include limitations, FAQs,
open questions and source excerpts. [Citation checks](../../clients/apps/web/lib/launch/citations.ts)
validate source IDs, while [copy guards](../../clients/apps/web/lib/launch/guards.ts) validate
claim references. [Launch persistence](../../server/internal/product/launch.go)
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

## Technical design: versioned evidence graph

Apply the [shared implementation contracts](../release-readiness-technical-contracts.md).
The graph below is persisted relational data, not an LLM memory or a set of
URLs embedded in a prompt. A source identity is mutable; each evidence and
claim version is immutable. Human decisions name the exact pair being reviewed.

### Relations, indexes and content representation

| Proposed table | Important fields | Keys / constraints |
| --- | --- | --- |
| platform_evidence_source | Org, kind, provider identity or attestation ID, access class, current version, change sequence, availability | Unique org/source-kind/provider-identity; no credentials in identity/URL; index current state. |
| platform_evidence_version | Source, version, raw hash, normalized hash, normalization version, private object key, MIME, bytes, captured/provider time, retrieval status, tombstone | Unique org/source/version; immutable bytes/hash; successful text evidence needs retained content, not hash alone. |
| platform_release_evidence | Release, evidence version, purpose, attaching actor | Unique org/release/evidence-version; same-org source may support several releases without copying bytes. |
| platform_evidence_attestation | Evidence version, accountable author, observed time, scope, limitations, confirmed-by/at, origin | Immutable confirmation event; AI-origin content has no human confirmation until an explicit authored attestation replaces it. |
| platform_release_claim | Release, stable claim ID, current version pointer | Unique org/release/ID; independent of section ordering. |
| platform_release_claim_version | Claim, version, spec ID/version, exact text, qualifiers JSON, content hash, author, origin | Unique org/claim/version; spec belongs to the same release; hash includes qualifiers. |
| platform_claim_support_set | Claim version, set version, canonical set hash, author | Unique org/claim-version/set-version; immutable membership; current set selected by explicit pointer. |
| platform_claim_support | Support set, claim version, evidence version, selector JSON, relation SUPPORTS/CONTRADICTS/CONTEXT | Unique normalized selector per support-set/evidence/relation; index org/evidence-version/claim-version for reverse impact. |
| platform_claim_verification | Claim version, support-set hash, decision, reviewer, reason, decided time, superseded decision | Append-only; FK to exact claim version; one current decision pointer per claim version. |
| platform_claim_path_binding | Spec version, legacy claim path, stable claim version | Unique org/spec-version/path; never resolve an old path against the newest spec. |

Store the reviewed support-set hash from sorted evidence-version IDs, hashes,
selectors and relations. The verification binds claim hash, qualifier hash
and support-set hash, not merely claim ID. Contradictory evidence must be
included in the review set or explicitly excluded with a recorded reason.
Attachments submitted after review produce a new support-set revision and
require a new decision if material.

For text, store a bounded UTF-8 normalized snapshot plus a versioned extractor
identity. A selector is a half-open byte interval in those exact bytes:

```json
{
  "kind": "TEXT_SPAN",
  "startByte": 84,
  "endByte": 173,
  "quoteSha256": "<sha256-of-selected-bytes>",
  "contextSha256": "<sha256-of-snapshot>"
}
```

Validate interval bounds, UTF-8 character boundaries and the selected quote
hash in Go. Display escaped text; source instructions are inert data. A span
offset in fetched HTML cannot be reused against cleaned text. First-slice
limits: 256 KiB normalized text per snapshot, 100 claims per spec, 20 support
selectors per claim, 4 KiB claim text, 8 KiB rationale. Larger sources require
explicit bounded excerpts with source offsets/truncation labels, not silent
truncation of a supporting sentence.

Image selectors use pixel coordinates `(x, y, width, height)` plus immutable
asset ID/hash, original dimensions, crop transform and reviewed redaction
version. Require bounds within the original image. A rendered crop alone
cannot prove which original product screen it came from. Redaction creates
new derived bytes linked to the original restricted asset; old confidential
pixels never enter the public artifact manifest.

Access classes are PRIVATE_SOURCE, INTERNAL_MATERIAL and CUSTOMER_CLEARED.
Classifying evidence as CUSTOMER_CLEARED requires a human decision with scope
and rationale; workspace membership alone is insufficient. Customer artifacts
contain approved facts/excerpts, not private source URLs or the internal
support manifest. A separate permissioned review DTO returns those references.

### Claim import and stable identity

The current spec uses section/index paths such as capabilities.0 and source
labels such as S1. During import, allocate a stable claim ID for every material
claim and store `(specVersion, oldPath) -> claimVersion`. Resolve S1 against
that spec's own source snapshot, never a later spec's S1. A reorder operation
must submit stable IDs; identical text alone is not enough to merge identities.

For legacy specs with no stable IDs, the adapter creates an explicit initial
mapping. An ambiguous later import creates new unverified claim versions
instead of guessing. Keep historical spec approval fields untouched and label
their new claim coverage unverified. Extend
[spec validation](../../clients/apps/web/lib/launch/spec-schema.ts),
[citation validation](../../clients/apps/web/lib/launch/citations.ts) and
[copy guards](../../clients/apps/web/lib/launch/guards.ts) to accept versioned claim references
while preserving old readers. A valid reference remains a syntactic check.

### Commands and verification transaction

| Proposed public endpoint under /api/v1 | Input / behavior |
| --- | --- |
| POST /releases/{id}/evidence | Existing owned asset, bounded source snapshot or human attestation; creates source/version with explicit origin. Remote fetch is a job, not arbitrary synchronous URL access. |
| POST /releases/{id}/claims | Expected aggregate revision, spec version, stable IDs where existing, text and qualifiers; creates immutable versions. |
| POST /releases/{id}/claims/{claimId}/support | Expected revision, claim version, evidence versions and selectors; creates reviewable support set. |
| POST /releases/{id}/claims/{claimId}/decisions | Expected revision, claim version/hash, support-set hash, decision, rationale; assigned human reviewer only. |
| GET /releases/{id}/claims | Current versions, decisions, missing support and permitted review excerpts; cursor pagination. |

Decisions are SUPPORTED, CONTRADICTED, UNRESOLVED or WITHDRAWN. SUPPORTED
requires at least one accessible successful snapshot or valid named human
attestation, valid selectors, complete qualifiers and an explicit support
rationale. It records accountable human judgment; the system does not claim
that a database constraint proves semantic entailment.

```text
authorize assigned human reviewer
lock authority rows, all reviewed source heads, then release aggregate
compare aggregate revision, current claim version and support-set hash
reject tombstoned/unavailable evidence or unacknowledged changed sources
validate selectors and attestation author/time/scope
append decision with exact source sequences and reviewer
advance current decision pointer + aggregate revision; write audit/outbox
commit
```

An attestation stores the accountable author, observed-at time, claim scope,
limitations and original text. Require the author to explicitly confirm it in
a session; importing a model-authored brief records AI origin and cannot set
that confirmation. A reviewer can accept a confirmed owner's attestation,
but the act of reviewing does not change an AI draft's provenance.

### Invalidation, retention and implementation gates

Claim text/qualifier changes create a new UNRESOLVED version. Editing another
claim does not erase an unchanged decision. Source replacement, confirmed
withdrawal, material access loss or deletion increments the source change
sequence synchronously; approval and send operations compare pinned sequences
even before RFC 006's impact queue exists. A transient fetch failure records
an unsuccessful observation and does not overwrite last good evidence or
assert contradiction. A confirmed permission revocation makes support
unavailable and blocks reuse.

Object deletion first tombstones the evidence row and advances the source
fence, then queues physical byte deletion. Block new reads immediately even
if storage deletion retries. Audit stores identifiers and allowed hashes, not
copies of deleted passages. Object-store failures leave a retryable cleanup
receipt; they cannot restore admissibility. New evidence needs new review.

| Slice / test | Implementation gate |
| --- | --- |
| Manual claims + evidence | Ent/SQL and Go transaction tests cover foreign org/release FKs, invalid spans, Unicode boundaries, size limits and rollback. |
| Legacy import | Reorder, duplicate text, S1 changing between specs and ambiguous imports cannot silently rebind verified claims. |
| Human decisions | Two reviewers racing yield one current decision; wrong support hash, stale claim, revoked membership and API-key direct calls fail. |
| Invalidation bridges | Existing spec revision, asset deletion and source-refresh paths advance the right source/aggregate fence; unrelated claims stay intact. |
| Optional assistance | Labeled supported/irrelevant/contradicted fixtures; generated suggestions cannot call human-decision operations or change source access classification. |
| Retention | Tombstoned excerpt disappears from API, model input and export; orphan cleanup retries without reactivating support. |

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
using RFC 001's cohort definition. Also measure reviewer effort and unresolved
claims. Citation coverage alone is not a factual-accuracy score.

## Rollout and rollback

Start with manual review on a pilot cohort and compare reviewer decisions with
the assisted baseline. Add model assistance only if it reduces review effort
without increasing corrections. A feature switch can stop new assistance;
retain versioned evidence and decisions, and never bypass verification to
recover a failing generator.
