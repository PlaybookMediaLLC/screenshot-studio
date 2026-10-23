# RFC 051: Evidence-Based Material Freshness

**Status:** Proposed — after repeat release-kit use
**Date:** 2026-10-23
**Owners:** Product Engineering
**Depends on:** RFC 013, RFC 023, RFC 047, RFC 049, RFC 050
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
RFC 047 are essential: list reordering must not look like changed product
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
support this RFC; authenticated recapture is optional through RFC 048.

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
6. An approved correction can follow RFC 050 to each affected destination,
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
