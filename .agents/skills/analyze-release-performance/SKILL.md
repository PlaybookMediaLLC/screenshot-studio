---
name: analyze-release-performance
description: Analyze Screenshot Studio release communication outcomes. Use when adding provider metrics, artifact performance reporting, channel comparisons, attribution, experiment analysis, optimization recommendations, or tenant performance dashboards.
---

# Analyze Release Performance

Read RFC 002, RFC 005, and RFC 007. Measure outcomes only after publication
receipts and metric sources are reliable.

## Measurement contract

1. Record metric source, fetch time, provider post ID, destination, artifact
   revision, release, organization, and metric definitions.
2. Separate delivery metrics from product outcomes. Impressions, clicks,
   signups, and activated users are different measures with different sources.
3. Keep all metric queries organization-scoped. Do not compare customer data or
   expose one tenant's benchmark to another without an explicit aggregate-data
   policy.
4. Show coverage, missing data, sampling limits, and time window before making
   a recommendation.

## Analysis rules

- Compare like-for-like channels, audience sizes, and time windows.
- Prefer absolute counts with rates and denominators.
- Treat provider metrics as delayed and mutable until their documented window
  closes. Preserve snapshots rather than overwriting historical observations.
- Label an observation as correlation unless a controlled experiment proves a
  causal result.
- Do not fabricate performance data for new providers or empty releases.

## Output

Return one actionable recommendation tied to a release, artifact pattern,
channel, and confidence limit. Avoid global scoring until enough consistent
data exists.
