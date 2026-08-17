# RFC 009: Marketing Platform Thesis and Customer Loop

**Status:** Proposed
**Date:** 2026-08-17
**Depends on:** RFC 001 through RFC 008
**Owners:** Product and Engineering

## Decision

Freeze the product promise before any agent work starts:

> Give us your SaaS URL and what you shipped. We turn it into polished,
> ready-to-publish marketing content.

Do not promise "AI runs your entire marketing department."

Build the platform inside-out, in this order:

1. Deterministic marketing primitives (RFC 010 through RFC 014).
2. Structured campaign generation (RFC 015).
3. An AI agent on top (RFC 016 through RFC 018).
4. Approval, publishing, and the core workflows (RFC 019 through RFC 021).
5. Triggers, analytics, and autonomy (RFC 022 through RFC 031).

If we reverse this order and start with the agent, we debug hallucinated
workflows instead of building a product.

## The customer loop

Every phase must serve this loop:

```text
Connect product
      ↓
Understand product
      ↓
Choose marketing objective
      ↓
Generate campaign
      ↓
Generate actual assets
      ↓
Founder edits/approves
      ↓
Publish
      ↓
Measure
      ↓
Generate next campaign
```

## Product generations

We plan five generations:

- **V1** — Screenshot Studio plus AI creative generation.
- **V2** — URL → campaign.
- **V3** — product changes → campaigns automatically.
- **V4** — campaign → publish → performance → next campaign.
- **V5** — full marketing intelligence across GitHub, website, and analytics.

## Critical path

The critical path is RFC 010 through RFC 021. When a founder can paste a SaaS
URL, get seven good posts with real product screenshots, approve them, and
schedule them, we have a product founders can pay for. Everything after that is
an expansion of the same object model.

## Out of scope

- Ads, SEO, email marketing, UGC, and audience discovery.
- Autonomous publishing without approval.
- Any horizontal expansion before the three core workflows (RFC 021) are
  excellent.
