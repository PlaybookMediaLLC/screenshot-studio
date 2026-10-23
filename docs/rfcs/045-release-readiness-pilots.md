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
