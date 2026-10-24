# RFC 045: Release Readiness and Paid-Pilot Validation

**Status:** Proposed — product direction adopted for planning; pilot results unvalidated
**Date:** 2026-10-23
**Owners:** Product and Engineering
**Depends on:** RFC 006, RFC 019, RFC 035
**Supersedes:** RFC 009 and RFC 021 as product priorities; preserves their reusable implementation
**Execution:** Milestone 0 in the [RFC execution order](README.md)

## Decision

Make release-ready product communication the Shots product promise. Validate
it through assisted paid pilots before funding broader marketing automation.
One meaningful product change should produce one approved kit used by the
people responsible for explaining it. Seven posts, a new canvas, or connecting
every social network is not a prerequisite.

The [company brief](../../company.md), [vision](../../vision.md), and
[codebase audit](../release-readiness-audit-2026-10-23.md) are the starting point.
This RFC defines a program and measurement contract; it does not claim those
results exist or change billing entitlements.

## First useful slice

Recruit B2B SaaS teams with roughly 20–200 employees and two meaningful release
moments per month. Confirm those hypotheses in interviews. Reconstruct a recent
release with its launch owner, then deliver three to five real kits with
controlled human assistance using current release specs, screenshots, editing,
approval and exports. Keep an explicit checklist for every gap the product
does not yet enforce.

Each kit includes a fact sheet, sales and CS talking points, customer
announcement, FAQ and branded screenshots, with omissions justified by the
owner. Record the intended audiences and required materials before evaluating
the outcome. Social/email variants are optional. An operator drafts; a
customer-authorized human confirms facts and approves exact deliverables.

Do not present this assisted process as an automated readiness gate. Existing
subscription gates remain in force. Pilot pricing around $199–$399/month or a
per-release fee requires an agreed commercial arrangement; this RFC creates
no Stripe prices, discounts or access bypasses.

## Measurement contract

Initially keep a workspace-scoped pilot ledger alongside the release record,
using a customer-approved private document or export if a native field does
not exist. Product owns the ledger; Engineering owns traceable IDs and costs.
Migrate it to native events with RFC 050 without manufacturing historical use.

| Measure | Definition |
| --- | --- |
| Adopted release kits | Count distinct workspace + qualified release IDs with an exact approved kit revision, successful required handoffs and recorded use for each required audience. Partial audience use remains visible but does not count as a fully adopted kit. Revisions and retries do not create new releases. |
| Active organization | A participating paid-pilot or subscribed organization with at least one qualified meaningful release in the reporting month. Report this denominator, total adopted releases and adopted releases per organization together. |
| Eligible-release coverage | Adopted qualified releases / all qualified meaningful releases in the cohort. Retain missing, declined and undelivered outcomes; report zero-denominator periods as not applicable. |
| Audience coverage | Required audiences with a successful handoff and use evidence / required audiences, frozen at qualification or explicitly revised with a reason before delivery. Record each audience separately. |
| Release-to-approval time | Time from the owner-confirmed release-ready timestamp to first kit approval, with intake-to-approval reported separately. Early approvals are marked pre-release; missing timestamps stay unknown. |
| Labor saved | Comparable prior-release customer effort minus measured current customer effort. Label estimates; report operator assistance separately and also report total effort. |
| Factual correction rate | Delivered kits requiring at least one substantive factual correction / delivered kits in the cohort, measured at a stated follow-up window. Corrections include capability, rollout, audience, benefit or limitation errors. Count affected claims separately; style edits are excluded. |
| Repeat use and retention | Organizations using another kit on a later eligible release, paid renewal and explicit renewal intent, each reported separately. Interview interest is not payment or retention. |
| Economics | AI, capture, rendering, storage/delivery and human assistance cost per delivered and adopted kit, compared with actual collected revenue. |

Monthly cohorts use the first human qualification date. Report adoption as of
an explicit cutoff and compare cohorts at the same follow-up age; late adoption
updates the original cohort rather than adding a second release. Keep the
eligible-release and active-organization denominators on that same cohort.

A delivery receipt, link click or social impression is not sufficient use
evidence. Accept a named sales/CS owner's confirmation tied to a revision, or
a verifiable customer publication/use record. Record audience, evidence type,
source, actor and time. Customer comprehension remains a research question,
not an inference from delivery. Store evidence under workspace access rules;
avoid copying customer conversations into analytics.

## Gates and learning agenda

The day count starts when the pilot program begins, independently of engineering
milestones. These are targets, not traction claims.

1. Days 1–14: 15 buyer interviews and three credible paid-pilot commitments.
2. Days 15–30: real kits delivered; payment authorization from at least two buyers.
3. Days 31–60: repeat release cycles at three customers and measured labor savings.
4. Days 61–90: test at least five paying organizations, repeat use, renewal intent
   and a plausible acquisition process.

At each gate review unsupported claims, substantive corrections, unused
materials, missing evidence and operator effort. Weak demand triggers a change
to the segment, offer or workflow before feature expansion. Existing customer
support and reliability work continue regardless of the expansion gate.

## Technical design: ledger and reproducible measurement

Use the [shared implementation contracts](../release-readiness-technical-contracts.md)
for tenant isolation, immutable IDs and later native ingestion. The first pilot
does not depend on a new analytics service. Keep UTF-8 JSONL records in a
workspace-approved private store, validate them with a versioned JSON Schema,
and produce a deterministic report from an explicit export. Do not commit
customer records to this repository. CSV is a presentation export, not the
canonical event format: empty, zero and unknown must remain distinct.

### Event and entity schema

The following are proposed ledger records. IDs must be stable across a later
import; all timestamps use RFC 3339 UTC and all costs are integer micros plus
an ISO currency. Require server/operator recording time separately from the
time an event was observed.

```typescript
type PilotEvent = {
  schemaVersion: 1
  eventId: string              // UUID, stable across export/import
  organizationId: string
  releaseId: string            // existing release ID, never a PR number
  canonicalReleaseId: string
  kitRevisionId: string | null
  audienceId: string | null
  kind: 'QUALIFIED' | 'KIT_APPROVED' | 'HANDOFF_RECORDED' | 'USE_CONFIRMED'
    | 'FACT_CORRECTION' | 'EFFORT_RECORDED' | 'COST_RECORDED'
    | 'PAYMENT_AUTHORIZED' | 'PAYMENT_COLLECTED' | 'RENEWAL_RECORDED'
    | 'RECORD_CORRECTED'
  occurredAt: string
  recordedAt: string
  actorId: string
  provenance: 'CUSTOMER_CONFIRMED' | 'OPERATOR_OBSERVED' | 'ESTIMATED'
  sourceRef: string | null     // access-controlled evidence reference
  supersedesEventId: string | null
  payload: unknown            // discriminated schema for each kind below
}
```

| Record | Required payload and validation |
| --- | --- |
| Release registration | Existing org/release, canonical ID, owner, eligibility, qualification time, owner-confirmed ready time or null, audience requirement revision. Reject a release from another organization. |
| Qualification | Human decision reference and immutable required audience/material list. A minimum of one required audience; exclusions require reason and author. Preserve first qualification time through requalification. |
| Approval | Artifact manifest hash, human reviewer, approval time, evidence/checklist reference. An assisted approval is tagged manual; it is not a native readiness-service result. |
| Handoff | Exact kit revision/hash, audience, destination identity, occurred time, receipt source and confirmation. Export/download alone fails this schema's delivered predicate. |
| Use | Exact kit revision, audience, named confirming user or publication reference, observed time, verified/pending/retracted state, verification actor/time. A click event is not an admissible use kind. |
| Effort | Task category, customer/operator role, integer minutes, measured/estimated, comparable baseline release ID. Do not infer customer time from operator activity duration. |
| Cost | Meter/run reference or invoice line, category, quantity, integer amount micros, currency, estimated/settled. Deduplicate on provider/meter line identity. |
| Correction | Delivered revision, affected claim IDs if known, factual/style classification, severity, detection time, resolution revision. Denominator counts kits/releases, not the number of corrected claims. |
| Commercial | Agreement reference, currency, amount, authorization/collection/refund status, occurrence time. A commitment and an authorized payment cannot populate collected revenue. |

Maintain a separate organization participation record with effective dates for
paid-pilot/subscription eligibility. Contract-level payment records may use a
nullable release ID in their discriminated subtype; do not invent a release
to attach revenue. Allocate organization-level service cost/revenue to releases
only with an explicit allocation rule, and show unallocated amounts.

Correct errors by appending a replacement event with a reason; never silently
edit an observed result. Reject cycles, cross-organization supersession and
two active replacements of the same event. Preserve the original record for
audit, subject to retention. Erasing confidential source evidence leaves a
minimal tombstone and downgrades verification to unavailable.

### Aggregation algorithm

Report parameters are metric-definition version, cohort month, as-of time and
follow-up window in whole days. Store those parameters and input export hash
with every report. UTC month boundaries are inclusive at start and exclusive
at the next month's start; day durations are elapsed 24-hour intervals.

```text
effective events = records recorded by asOf, resolving valid corrections
cohort = canonical releases first human-qualified in [monthStart, monthEnd)
         whose organizations participated at first qualification
observation cutoff per release = min(asOf, firstQualifiedAt + followupDays)
for each cohort release:
  load the reviewed audience requirement revision effective before delivery
  for each required audience:
    find a valid approval -> confirmed handoff -> verified use chain
    require the SAME kit revision and audience throughout each chain
    require all occurredAt values <= that release's observation cutoff
  adopted = every required audience has such a chain
active organizations = distinct orgs in cohort, including zero-adoption orgs
adoption numerator = distinct canonical releases with adopted = true
```

Audience-specific kit revisions may differ when a correction was delivered,
but each audience's chain must be internally consistent. An approval of version
2 does not validate a handoff of version 1. Do not combine use of a draft with
delivery of an approved version. Show retracted/invalidated use chains and
substantive corrections alongside the as-of adoption result.

Freeze the denominator at first qualification and retain later withdrawals as
visible outcomes. An eligibility correction requires an auditable data-quality
restatement, not deletion from the cohort. Audience requirement changes after
the first delivery do not retroactively reduce that cohort's denominator;
store an explicit prospective revision and report the exception separately.
Unmatured releases are labeled censored; compare matured subsets at the same
follow-up age and report their counts rather than treating missing follow-up
as observed failure. Late-recorded evidence restates its original cohort.

Release-to-approval durations may be negative for pre-release approval: report
those separately, not as zero. Calculate median and p90 only from observed
durations and publish sample size plus missing count. Labor-saved estimates
need a comparable baseline and task scope; otherwise return null. Do not sum
currencies without a dated exchange-rate policy. Cost per adopted kit is not
applicable when the adoption count is zero; still report absolute cost.

### Native ingestion bridge and delivery slices

RFC 050 adds a session-only import operation under the existing API boundary.
It accepts at most 200 events / 1 MiB per batch, validates the entire batch,
and commits it atomically with an idempotency receipt. Uniqueness is
`(org, importSource, eventId)`. Identical replay returns the original receipt;
a changed payload conflicts. Unknown native kit IDs go to a staging record
with the manual manifest hash, never to a fabricated native approval.

Retain original occurrence, recording and import times, actor attribution and
provenance. An importing admin is not the original approver. Reports support
manual and native records under the same predicates, with the provenance
breakdown visible. Reconcile aggregate counts before switching a pilot to
native reporting; mixed imports cannot count the same event twice.

| Slice | Deliverable | Verification gate |
| --- | --- | --- |
| A: assisted cycle | Schema, blank ledger template, private evidence references, report command with explicit parameters | Synthetic complete and incomplete release fixtures produce inspectable rows and totals. |
| B: cohort review | Qualification/approval/handoff/use joins, effort and commercial reports | A second reviewer reproduces a report from its input hash and parameter manifest. |
| C: native bridge in 050 | Import receipt and native event adapters, same metric definitions | Manual/native mixed fixture and repeated import produce identical unique release counts. |

### Required measurement fixtures

| Fixture | Expected result |
| --- | --- |
| Two required audiences; only sales confirms use | Audience coverage 1/2, fully adopted count 0. |
| Two kit revisions and three retries for one release | At most one adopted release; evidence must match a delivered approved revision. |
| One org qualifies two releases, neither used | Active organizations 1, eligible releases 2, adoption 0. |
| Qualification at 23:59:59 UTC on month end; use next month | Original month cohort, observed only within the selected as-of/follow-up limits. |
| Late import, duplicate ID, corrected use, merge lineage | Stable IDs deduplicate; valid corrections restate rather than append a second success. |
| Missing baseline, unknown effort, zero adoption, mixed currencies | Null/not-applicable or separate currency totals; no invented zero or blended margin. |
| Payment authorized then fails; operator performs all work | Collected revenue 0; customer and operator minutes remain separate. |

## Acceptance criteria

1. A pilot record names the buyer, launch owner, fact reviewer, release and
   audience; hypotheses and observed facts are clearly distinguished.
2. A real kit has a versioned source/fact checklist, documented unresolved
   issues, exact approved artifacts and a human approval record.
3. The ledger can compute all definitions above without counting revisions,
   delivery attempts or generated assets as additional releases.
4. At least one complete assisted cycle is reviewable, including effort,
   costs, delivery and use evidence or an explicit unknown outcome.
5. Each commercial commitment distinguishes authorization, collected payment,
   repeat use and renewal. No new plan is reported as implemented.
6. A gate review records whether to continue, revise or stop an expansion and
   why; no numerical target is silently converted into an achieved result.

## Observability

Adopted release kits per active organization is the primary outcome. Review it
with eligible-release coverage and factual corrections so a smaller denominator
or excess output cannot disguise poor adoption. Collect the first baseline
before automation and preserve the measurement definitions as tooling evolves.

## Rollout and rollback

Start with a small, explicitly assisted cohort. Use existing access controls
and customer-approved destinations. Pause a pilot workflow if facts cannot be
verified or delivery scope is unclear; retain reviewed exports and records.
Later RFCs automate the most frequent observed bottlenecks. No deployment or
customer communication is performed by this documentation change.
