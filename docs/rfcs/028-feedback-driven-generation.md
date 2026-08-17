# RFC 028: Feedback-Driven Generation

**Status:** Proposed
**Date:** 2026-08-17
**Depends on:** RFC 027
**Owners:** Product and Engineering

## Decision

Close the loop from performance to generation. Introduce this only after
analytics exist. The agent moves from generative to genuinely useful when its
advice is grounded in the workspace's own data.

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

## Exit criterion

The weekly plan changes in response to real performance data, and the agent
explains each change with numbers.

## Out of scope

- Autonomous execution of recommendations. RFC 029 and RFC 030 gate that.
- Cross-workspace learning. Each workspace learns only from its own data.
