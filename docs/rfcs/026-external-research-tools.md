# RFC 026: External Research Tools

**Status:** Proposed
**Date:** 2026-08-17
**Depends on:** RFC 016 and RFC 025
**Owners:** Engineering and Security

## Decision

Add external research tools to the agent only now. Content can then move
beyond information already contained inside the SaaS. Delaying this is
deliberate: research becomes contextual because the agent already knows the
user's product, brand, audience, features, history, and published content.

## Design

New tools:

```text
searchWeb
researchCompetitors
researchIndustry
findTrendingTopics
```

Rules:

- Research tools follow the same contract as all tools (RFC 016):
  workspace-scoped, Zod-validated, audited.
- Research results attach to campaigns as sources, so a founder can see where
  a claim came from.
- Competitor names in generated copy trigger the review path regardless of
  other settings (see RFC 030).
- No tool fetches arbitrary URLs supplied by model output without the same
  SSRF guards the capture API uses.

## Exit criterion

The agent produces an industry-context post with cited sources, grounded in
the workspace's product profile.

## Out of scope

- SEO tooling, ad research, and audience discovery.
- Automatic ingestion of research into the product profile without review.
