# RFC 049: Marketing Platform Thesis and Customer Loop

**Priority:** 049 — Historical or superseded
**Previous ID:** 009 ([renumbering map](renumbering-2026-10-24.md))
> **Roadmap disposition (2026-10-23):** Product direction superseded by RFC 001 and the release-readiness vision. The numerical build order below is historical.
> See the [current execution order](README.md). Older decision text is
> historical wherever it conflicts with that order or the audited architecture.

**Status:** Superseded as product direction by RFC 001; reusable implementation retained
**Status note (2026-10-23):** The former URL-to-campaign and seven-post north star is historical. See RFC 001 and the current execution order for release-readiness priorities.
**Date:** 2026-08-17
**Historical dependencies:** RFCs 046, 010, 009, 050, 015, 011, 035, 045
**Owners:** Product and Engineering

## Decision

Freeze the product promise before any agent work starts:

> Give us your SaaS URL and what you shipped. We turn it into polished,
> ready-to-publish marketing content.

Do not promise "AI runs your entire marketing department."

Build the platform inside-out, in this order:

1. Deterministic marketing primitives (RFCs 020, 019, 017, 018, 021).
2. Structured campaign generation (RFC 047).
3. An AI agent on top (RFCs 027, 028, 022).
4. Approval, publishing, and the core workflows (RFCs 012, 030, 048).
5. Triggers, analytics, and autonomy (RFCs 016, 029, 036, 037, 038, 039, 040, 041, 043, 044).

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

The critical path is RFCs 020, 019, 017, 018, 021, 047, 027, 028, 022, 012, 030, 048. When a founder can paste a SaaS
URL, get seven good posts with real product screenshots, approve them, and
schedule them, we have a product founders can pay for. Everything after that is
an expansion of the same object model.

## Out of scope

- Ads, SEO, email marketing, UGC, and audience discovery.
- Autonomous publishing without approval.
- Any horizontal expansion before the three core workflows (RFC 048) are
  excellent.
