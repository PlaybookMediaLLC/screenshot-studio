# RFC 028: Feedback-Driven Generation

**Status:** Proposed
**Date:** 2026-08-17
**Revised:** 2026-08-26
**Depends on:** RFC 025 and RFC 027
**Owners:** Product and Engineering

## Decision

Close the loop from performance to generation. Introduce this only after
analytics exist. The agent moves from generative to genuinely useful when its
advice is grounded in the workspace's own data.

The loop adjusts explicit, inspectable weights. It does not fine-tune a model,
does not silently rewrite prompts, and does not change approved content. A
founder must be able to read why the plan changed and disagree with it.

## Design

New tools:

```ts
analyzePerformance()
recommendNextCampaign()
findWinningAngles()
findWeakContent()
```

Expected agent behavior:

> Posts showing the actual UI produce 2.4× the engagement of your text-only
> posts. I have weighted this week's plan toward product demonstrations.

Rules:

- Every recommendation cites the metric that produced it.
- Recommendations adjust weights in weekly planning (RFC 025); they do not
  silently rewrite approved content.
- Small samples are labeled. The agent must not present three data points as
  a trend.

## Goals

- Planning that measurably improves as a workspace publishes more.
- Every adjustment explainable in one sentence with numbers.
- Statistical honesty, including saying "we do not know yet".
- A reversible mechanism: any adjustment can be undone.

## Non-goals

- Autonomous execution of recommendations. RFC 029 and RFC 030 gate that.
- Cross-workspace learning. Each workspace learns only from its own data.
- Model fine-tuning on customer data.
- Attribution to revenue. Engagement is the observable signal.

## Signals

Two categories, and the second is available far earlier.

### Performance signals (RFC 027)

| Signal              | Definition                                    |
| ------------------- | --------------------------------------------- |
| Engagement rate     | (likes + comments + shares) / impressions, at matched age |
| Amplification rate  | shares / impressions                          |
| Conversation rate   | comments / impressions                        |
| Click rate          | clicks / impressions, where the platform reports clicks |

Rates rather than counts, because follower growth would otherwise make every
recent post look better than every older one.

### Editorial signals (available immediately)

| Signal              | Definition                                        |
| ------------------- | ------------------------------------------------- |
| Approval rate       | Share of generated posts approved without changes |
| Edit distance       | Normalized change between generated and approved copy |
| Rejection rate      | Share rejected outright                           |
| Regeneration count  | Regenerations before approval                     |
| Time to decision    | How long a post sat in review                     |

Editorial signals matter more than they first appear. They need no analytics
integration, no publishing, and no waiting: a workspace that has published
nothing still generates dozens of them in its first session. A founder
rewriting every generated hook is a stronger, faster quality signal than
engagement data arriving weeks later.

## Dimensions

Signals aggregate along the frozen attribution from RFC 027:

```text
channel
pillar (RFC 025)
content angle type
creative type          screenshot | annotated | comparison | carousel | video | none
hook pattern           question | statistic | contrarian | story | announcement
CTA presence and type
posting day and hour
copy length bucket
```

Each dimension is a candidate weight adjustment. Cross-dimension analysis is
restricted to pairs; deeper slices exhaust the sample immediately.

## Statistical discipline

This is where the feature is honest or worthless.

| Rule                        | Threshold                                       |
| --------------------------- | ----------------------------------------------- |
| Minimum posts per group     | 5 to report, 10 to adjust weights               |
| Minimum comparison span     | 14 days                                         |
| Confidence reporting        | Always shown with the sample size               |
| Effect size floor           | Below 20% relative difference is not reported   |
| Multiple comparisons        | Only pre-registered dimensions are tested       |
| Coverage requirement        | Metrics for at least 70% of published posts     |

Below any threshold the system says so, in words a founder understands: "You
have 4 LinkedIn posts. I need a few more before I can tell what works." That
sentence is a better product than a fabricated trend, and it is what "the agent
must not present three data points as a trend" means operationally.

Confounders are named rather than corrected away. Comparisons state when
compared groups differ in timing, channel mix, or campaign type. A launch week
outperforms a normal week for reasons unrelated to creative type, and the
report says so.

## Adjustment mechanism

Recommendations adjust RFC 025 pillar weights and generation preferences. The
mechanism is deliberately conservative:

```ts
WeightAdjustment {
  id
  workspaceId
  dimension              // pillar | creativeType | hookPattern | postingTime
  key                    // the specific value
  previousWeight, newWeight
  evidence {
    sampleSize, effectSize, comparisonWindow, metric, groups
  }
  status                 // proposed | applied | reverted | expired
  appliedAt, appliedBy   // system in autopilot, user otherwise
  revertedAt, revertReason
}
```

Rules:

- One adjustment per dimension per week, at most.
- A single adjustment moves a weight by at most 20% of its current value.
- Weights have floors, so a pillar is never driven to zero by data. A workspace
  should not stop posting founder content because three founder posts
  underperformed.
- Every adjustment expires after 90 days unless re-supported by fresh evidence,
  so the system does not carry a stale conclusion forever.
- Every adjustment is revertible, individually or as a full reset to defaults.

Bounded, slow, reversible adjustment is the right shape because the underlying
data is noisy, the sample is small, and the cost of a wrong conclusion
compounds across every future week.

## Negative signals

Underperformance is treated asymmetrically from outperformance:

- A weak group's weight is reduced, never eliminated.
- Deprioritization requires more evidence than promotion, because removing a
  content type is harder to notice and harder to undo than adding one.
- A pillar consistently weak is surfaced as a question rather than acted on:
  "Your educational posts underperform. Do you want fewer of them, or should we
  try a different format?" The founder often knows why, and the reason is
  usually not the one the data suggests.
- Novelty is protected: a content type with no recent attempts is periodically
  re-tried regardless of past weakness, so the system does not permanently lock
  itself out of a category after an early bad run.

## Explainability

Every recommendation carries a structured explanation:

```ts
Recommendation {
  statement          // "Posts with UI screenshots get 2.4x engagement"
  metric             // engagement rate at 24h
  groups             // [{ label, n, value }]
  effectSize
  confidence         // high | moderate | low
  window
  caveats[]          // named confounders
  proposedAdjustment?
}
```

The workspace UI shows the underlying posts for any claim, so a founder can
click "2.4×" and see the eight posts behind it. A claim whose supporting posts
are not inspectable is not shown.

The agent's phrasing must match the confidence. "Posts with screenshots did
better in a small sample" and "posts with screenshots get 2.4× engagement" are
different claims, and the second requires the thresholds above.

## Experiments

Deliberate testing beats passive observation, and the mechanism stays simple:

- A planned week can allocate slots to a variant, such as annotated versus
  plain screenshots.
- Assignment is randomized within matched slots to control for timing.
- A minimum sample is declared before the experiment starts, and no conclusion
  is drawn before reaching it.
- Results feed the same adjustment mechanism with a confidence bonus, because
  randomized assignment is stronger evidence than observation.
- Experiments are visible and stoppable by the founder.

## Tenant boundaries

Each workspace learns only from its own data. This is a hard boundary:

- No cross-workspace aggregation, benchmarking, or "similar companies" data.
- No customer content or performance data trains any shared model.
- Platform-level defaults are set from public knowledge and internal testing,
  never from customer aggregates.

The boundary costs statistical power for small workspaces, and it is worth it.
A B2B SaaS founder cannot be told that their content is being pooled with a
competitor's to improve suggestions.

The cold-start answer is editorial signals and platform defaults, not borrowed
data.

## Authorization

| Operation                      | Permission        |
| ------------------------------ | ----------------- |
| Read recommendations           | `workspace:read`  |
| Apply an adjustment            | `brand:manage`    |
| Revert an adjustment           | `brand:manage`    |
| Start or stop an experiment    | `brand:manage`    |
| Reset all weights              | `brand:manage`    |

In Manual and Copilot modes (RFC 031), adjustments are proposals a human
applies. In Autopilot they may apply automatically within the bounds above,
audited, and always revertible.

## Failure behavior

| Situation                        | Behavior                                        |
| -------------------------------- | ----------------------------------------------- |
| Insufficient data                | State it plainly; make no adjustment            |
| Metric coverage below 70%        | Report the coverage gap; make no adjustment     |
| Contradictory signals            | Report both; make no adjustment                 |
| Analytics unavailable            | Fall back to editorial signals                  |
| An adjustment worsens outcomes   | Detected on re-evaluation and reverted          |
| All weights at their floor       | Stop adjusting; recommend a strategy review     |

The default action is always "make no adjustment". A feedback loop biased
toward acting will act on noise, and acting on noise in a compounding weekly
cycle is worse than not having the loop.

## Security threats

This loop lets measured outcomes change what the system generates, which makes
it the one place where an attacker who can influence numbers can influence
copy. The defense is that recommendations are proposals a human accepts, never
silent parameter drift.

| Threat                                       | Mitigation                                                 |
| -------------------------------------------- | ---------------------------------------------------------- |
| Manipulated engagement steering house style  | Adjustments surface as reviewable recommendations with their evidence |
| Cross-tenant learning                        | Every signal is workspace-scoped; nothing is pooled across tenants |
| Thin samples presented as findings           | Sample size is shown; below threshold the loop reports uncertainty |
| Recommendation applied without attribution   | Applied adjustments are audited with actor, evidence, and prior value |
| Runaway drift across cycles                  | Adjustments are bounded and revertible to the prior state    |

Nothing here learns across workspaces. Pooling would produce better
recommendations and would also mean one tenant's performance data shapes
another tenant's marketing, which is a confidentiality boundary this product
cannot cross regardless of the modeling benefit.

## Observability

- Recommendations produced, shown, applied, and reverted.
- Adjustment revert rate, which measures recommendation quality.
- Metric coverage per workspace.
- Distribution of sample sizes behind shown claims.
- Trend in approval rate and edit distance after adjustments, which is whether
  the loop actually works.

That trend is the metric that actually matters. Everything else counts
activity: recommendations produced, shown, applied. Only the movement in
approval rate and edit distance after an adjustment says whether the loop
learned something true about this workspace.

It must be read against metric coverage from RFC 027. A trend computed from
40% of posts is a claim about a biased sample, and a loop that adjusts
confidently on thin data will amplify noise into a house style nobody chose.

## Acceptance criteria

1. The weekly plan changes in response to real performance data, and the agent
   explains each change with numbers.
2. A claim from 3 posts is not presented as a trend.
3. Every claim links the posts supporting it.
4. Groups below the minimum sample are reported as insufficient, not compared.
5. An effect below 20% is not reported.
6. Metric coverage below 70% blocks adjustments and says why.
7. No single adjustment moves a weight more than 20%.
8. No pillar is driven to zero.
9. Every adjustment is revertible and the revert takes effect on the next plan.
10. Adjustments expire after 90 days without fresh support.
11. A workspace with no published posts still receives editorial-signal
    recommendations.
12. No recommendation uses data from another workspace.
13. A weak content type is periodically re-tried.
14. Contradictory signals produce no adjustment.
15. Applying an adjustment never modifies approved or published content.
16. A `creator` cannot apply an adjustment.

## Rollout

1. Ship editorial signals first. They need no analytics and deliver value
   immediately.
2. Ship the recommendation model in report-only mode; no adjustments.
3. Validate claim quality manually against real workspaces before any weight
   moves.
4. Enable proposed adjustments requiring human application.
5. Add experiments.
6. Allow automatic application only under RFC 031 Autopilot with RFC 030
   policies.

## Out of scope

- Autonomous execution of recommendations. RFC 029 and RFC 030 gate that.
- Cross-workspace learning. Each workspace learns only from its own data.
