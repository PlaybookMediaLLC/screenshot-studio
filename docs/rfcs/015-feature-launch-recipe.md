# RFC 015: Deterministic Feature Launch Recipe

**Status:** Proposed
**Date:** 2026-08-17
**Revised:** 2026-08-26
**Depends on:** RFC 004, RFC 010 through RFC 014
**Owners:** Engineering

## Decision

Build the first campaign generator as normal application code that
orchestrates a few LLM calls. No agent. This delivers the first usable
product quickly and gives the future agent a proven capability to call.

A recipe is a named, versioned, resumable pipeline. The control flow is code.
The model fills in text at fixed points with schema-validated output. Nothing
about the sequence, the retries, or the persistence is decided by a model.

## Why a recipe before an agent

An agent that fails produces an unclear failure: was it the plan, the tool, the
prompt, or the model. A recipe that fails names its failing step. Building the
recipe first means that when RFC 016 adds an agent, the agent calls one proven
capability instead of orchestrating six unproven ones. This ordering is the
core commitment of RFC 009 and this RFC is where it pays off.

## Goals

- One call produces a complete, reviewable draft campaign.
- Every step is independently retryable and resumable.
- Bounded, predictable cost and duration per run.
- Partial success is useful: copy without a creative still beats nothing.

## Non-goals

- Conversational input. RFC 017 adds the agent.
- Publishing. The recipe stops at `DRAFT`.
- Recipe authoring by users. Recipes are code in this phase.
- More than the three recipes named in RFC 021.

## Design

One entry point:

```ts
createFeatureLaunchCampaign({
  workspaceId,
  feature,                      // free text, or a ProductProfile feature ref
  channels: ['x', 'linkedin'],
  objective?: 'feature',
  angleCount?: 3,               // 1-5
  surfaceSlug?: string,         // override the automatic lookup
  idempotencyKey: string,
}): Promise<RecipeRunHandle>
```

Input:

```text
Product: Acme
Feature: automated invoice approvals
Goal: announce launch
```

Output — a persisted Campaign (RFC 014):

```text
Campaign
├── Angle 1: eliminate approval bottlenecks
├── Angle 2: keep spending controlled
├── Angle 3: approvals without Slack chasing
├── X post
├── LinkedIn post
├── Instagram caption
├── hero screenshot
├── annotated screenshot
└── short demo
```

### Pipeline

```text
1. resolve-context      load ProductProfile, BrandProfile, ICP, BrandKit
2. match-surface        deterministic lookup (RFC 013), no LLM
3. capture-surface      capture if stale or missing (RFC 010)
4. generate-angles      1 LLM call, schema-validated
5. generate-copy        1 LLM call per channel per angle, batched
6. build-creatives      compose specs and render (RFC 010)
7. assemble-campaign    one transaction, status DRAFT
```

Steps 1 through 3 involve no model. Steps 4 and 5 are the only model calls.
Step 6 is deterministic rendering. The recipe runs as a Trigger.dev task and
each step is retryable.

### Step contract

Every step declares the same shape, which is what makes the pipeline
mechanically resumable:

```ts
RecipeStep<In, Out> {
  name
  version
  required        // does a failure fail the run
  idempotent      // can it safely re-run
  budget          // wall clock and token limits
  run(input: In, ctx: RecipeContext): Promise<Out>
}
```

Step outputs checkpoint to the run row. A resumed run replays only unfinished
steps. Because every step is idempotent, a replayed step is safe even if it
partially completed.

### Step dependencies and degradation

| Step             | Required | On failure                                            |
| ---------------- | -------- | ----------------------------------------------------- |
| resolve-context  | yes      | Fail the run; nothing can be generated without it     |
| match-surface    | no       | Continue with no surface; creatives use brand-only    |
| capture-surface  | no       | Continue with the most recent capture, marked stale   |
| generate-angles  | yes      | Retry twice, then fail the run                        |
| generate-copy    | partial  | A channel that fails is omitted; others proceed       |
| build-creatives  | no       | Posts persist without creatives, flagged as needing one |
| assemble-campaign| yes      | Fail the run; the transaction rolls back              |

Only three steps can fail a run. A campaign with copy and no creative is
useful, because a founder can attach a creative in the workspace. A campaign
with a creative and no copy is not. The degradation ordering follows that
asymmetry.

## Model calls

Only two step types call a model, both with the same discipline.

### Angle generation

- Input: product profile, ICP, feature, brand tone, and up to 10 recent post
  hooks so angles do not repeat.
- Output: `{ angles: [{ title, hook, rationale, pillar }] }`, Zod-validated.
- Retries: 2 on schema failure, with the validation error appended.
- Budget: one call, capped tokens.

### Copy generation

- Input: one angle, one channel, the channel's capability limits, brand tone,
  CTA conventions, prohibited terms, and the ICP.
- Output: `{ copy, callToAction }`, Zod-validated, length-checked against the
  channel limit.
- Retries: 2 on schema or length failure. Over-length retries include the
  measured overflow, since a model told "shorten by 40 characters" performs
  better than one told "too long".
- Prohibited terms are enforced after generation by RFC 011's filter, not
  trusted to the prompt.

Prompts are versioned. `promptVersion` is recorded in the provenance from RFC
014, so a quality regression is traceable to a prompt change.

Model choice is configuration, not code. Angle generation uses a stronger
model; copy generation uses a cheaper one. Both are swappable without touching
the pipeline.

## Determinism and variation

The pipeline is deterministic. The model calls are not, and should not be: two
runs for the same feature should produce different angles, because a founder
who dislikes the first set will click regenerate.

What must be reproducible is the record. `inputRefs` pins the profile version,
brand version, ICP version, and surface capture used. Given a run record, the
exact inputs are recoverable even if every one of them has since changed.

A `seed` parameter is accepted for testing and for the parity harness, making
runs reproducible when needed without making the product feel mechanical.

## Idempotency and concurrency

- `idempotencyKey` is required. A repeated call returns the existing run.
- One active recipe run per workspace per feature. A second request returns the
  active run rather than generating a duplicate campaign.
- The final assembly is a single transaction, so a campaign is never half
  written.
- If assembly fails after creatives were rendered, the rendered assets remain
  and are reused by the retry through RFC 010's content-addressed cache. A
  retry therefore costs almost nothing in render time.

## Budgets

| Limit                       | Value                                  |
| --------------------------- | -------------------------------------- |
| Wall clock per run          | 10 minutes                             |
| LLM calls per run           | 1 + (angles × channels), capped at 20  |
| Tokens per run              | Plan-scoped cap                        |
| Renders per run             | 2 per angle, capped at 10              |
| Concurrent runs per workspace | 1                                    |
| Runs per workspace per hour | Plan-scoped                            |

Exceeding the wall clock produces a partial campaign in `DRAFT` with the
completed steps recorded, not a failure. Exceeding the token budget stops
generation and assembles whatever exists.

Estimated cost is recorded per run and attributed to the workspace, so the
generation quota in RFC 034 is enforceable on real numbers rather than on a
per-call count.

## Failure behavior

| Failure                        | Code                        | Result                          |
| ------------------------------ | --------------------------- | ------------------------------- |
| No product profile             | `product_context_missing`   | Run fails; onboarding is offered |
| No surface matches the feature | `surface_not_found`         | Continues, creative degraded    |
| Capture fails                  | `capture_failed`            | Continues with a stale capture  |
| LLM schema failure ×3          | `generation_schema_failed`  | Run fails at that step          |
| LLM provider outage            | `generation_unavailable`    | Retried with backoff, then fails |
| Prohibited term ×2             | `content_policy_blocked`    | Post persists as blocked draft  |
| Render failure                 | `render_failed`             | Post persists without a creative |
| Assembly conflict              | `campaign_conflict`         | Rolled back and retried         |

A failed run leaves a `RecipeRun` row with its failing step, its inputs, and
its partial outputs. Reproducing a customer's failed generation must not
require asking the customer for anything.

Runs are cancellable. Cancellation stops after the current step, keeps rendered
assets, and does not create a campaign.

## Authorization

Running a recipe requires `release:create` for sessions or `release:create`
scope for API keys. It consumes the generation quota. Recipes always produce
`DRAFT`, so no permission gap lets a recipe produce approved content.

Every step writes to the audit log with the run ID, so a generated campaign has
a complete server-side trail from request to persistence.

## Observability

- Run duration and success rate by step.
- Step failure counts by code.
- Tokens and cost per run at p50 and p95.
- Schema-retry rate per prompt version, which is the prompt quality metric.
- Share of runs producing a full campaign versus a degraded one.
- Downstream: share of generated campaigns reaching approval, and edit distance
  on their copy.

Approval rate and edit distance are the only metrics that measure whether the
recipe is good. Duration and success rate only measure whether it is working.

## Acceptance criteria

1. One function call produces a complete draft campaign with real product
   screenshots and channel-specific copy in under a few minutes.
2. Every campaign is created in `DRAFT` and never any further.
3. A run with no matching surface still produces copy, with the creative
   degradation reported.
4. A failed render still produces posts, flagged as needing a creative.
5. A channel whose copy generation fails is omitted; other channels persist.
6. A repeated call with the same idempotency key returns the existing run.
7. A resumed run after a worker crash does not duplicate model calls or
   campaigns.
8. Copy for each channel respects that channel's capability limit.
9. Copy containing a prohibited term does not persist as approved.
10. A run exceeding its wall clock produces a partial campaign, not a failure.
11. A cancelled run creates no campaign and releases its resources.
12. Every generated post records its model, prompt version, and input refs.
13. A workspace at its generation quota is refused before any model call.
14. A run in workspace A cannot read any data from workspace B.

## Rollout

1. Ship steps 1 through 3, which involve no model, and verify context
   resolution and surface matching against real workspaces.
2. Add angle generation behind a flag; review output quality manually.
3. Add copy generation; measure schema-retry rate and edit distance.
4. Add creative building; run the RFC 010 parity harness on recipe output.
5. Enable for internal workspaces, then for all workspaces.
6. Add the `launch` and `visibility` recipes from RFC 021 by reusing the same
   step framework.

Rollback is a flag flip. Campaigns already generated are ordinary data.

## Out of scope

- Conversational input. RFC 017 adds the agent.
- Publishing. The recipe stops at `DRAFT`.
