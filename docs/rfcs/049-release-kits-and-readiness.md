# RFC 049: Role-Specific Release Kits and Readiness Gates

**Status:** Proposed
**Date:** 2026-10-23
**Owners:** Product Engineering
**Depends on:** RFC 006, RFC 010, RFC 011, RFC 019, RFC 037, RFC 046, RFC 047
**Execution:** Milestone 2 in the [RFC execution order](README.md)

## Decision

Add a versioned release-kit manifest linking verified facts to the actual
materials each audience needs. A kit is ready only when a backend evaluation
and an authorized human approve the exact versions being delivered. Reuse
existing release specs, drafts, creative documents, assets and approval
authority. Do not force sales/CS materials into a social-channel enum or
require a campaign, connected social account or chat session to complete a kit.

## Existing foundation

[Release specs and campaign plans](../../services/ent/schema/launch.go) already
have versions and approval records. [Content drafts](../../services/internal/product/content_drafts.go)
and [creative sets](../../services/ent/schema/platform_creative_set.go) provide
editable material; [launch decisions](../../services/internal/product/launch.go)
and [campaign transitions](../../services/internal/product/campaign_transitions.go)
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
them, resolve them, or record an eligible human attestation under RFC 047.

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
4. Connect the approved manifest to RFC 050's destination handoffs. Reuse
   existing social publishing only for requested, separately approved variants.

## Migration and compatibility

Use additive Go/Ent tables, migrations, Zod contracts and SDK methods.
Existing campaigns, Story Sets and drafts remain usable. Import them as draft
kit candidates with their source IDs/revisions; no historical campaign status
automatically certifies a new kit. Do not introduce a new renderer, editor,
scheduler or broad approval-policy engine as a prerequisite.

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
