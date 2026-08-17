# RFC 015: Deterministic Feature Launch Recipe

**Status:** Proposed
**Date:** 2026-08-17
**Depends on:** RFC 014
**Owners:** Engineering

## Decision

Build the first campaign generator as normal application code that
orchestrates a few LLM calls. No agent. This delivers the first usable
product quickly and gives the future agent a proven capability to call.

## Design

One entry point:

```ts
createFeatureLaunchCampaign({
  productId,
  feature,
  channels: ['x', 'linkedin'],
})
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

Pipeline steps:

1. Load `ProductProfile`, `BrandProfile`, and matching `ProductSurface`.
2. Generate content angles with one schema-validated LLM call.
3. Generate channel-specific copy per angle.
4. Build creatives through the creative engine (RFC 010).
5. Persist the campaign in `draft` status.

The recipe runs as a Trigger.dev task. Each step is retryable.

## Exit criterion

One function call produces a complete draft campaign with real product
screenshots and channel-specific copy in under a few minutes.

## Out of scope

- Conversational input. RFC 017 adds the agent.
- Publishing. The recipe stops at `draft`.
