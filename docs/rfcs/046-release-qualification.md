# RFC 046: Qualified Releases and Accountable Fact Intake

**Status:** Proposed
**Date:** 2026-10-23
**Owners:** Product Engineering
**Depends on:** RFC 005, RFC 006, RFC 022, RFC 045
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
   approval, scheduling or delivery. RFC 047 verifies claims; RFC 049 gates kits.

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
