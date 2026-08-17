# RFC 012: Product Intelligence Pipeline

**Status:** Proposed
**Date:** 2026-08-17
**Depends on:** RFC 010 and RFC 011
**Owners:** Engineering

## Decision

Implement "paste your URL" as a deterministic onboarding pipeline, not an
agent. The pipeline produces a persisted `ProductProfile` — long-lived product
memory. The model must not rediscover the company every time someone wants a
tweet.

## Design

```text
URL
 ↓
Fetch homepage
 ↓
Discover useful pages
 ↓
Capture pages
 ↓
Extract structured text
 ↓
LLM classification
 ↓
ProductProfile
```

- Page discovery follows internal links to a small, bounded set: pricing,
  features, docs, and changelog.
- Capture uses the existing capture API with its SSRF guards.
- One LLM classification call per onboarding, with a Zod-validated output
  schema. The pipeline retries on schema mismatch.
- The pipeline runs as a Trigger.dev task (RFC 004).

## Data model

```ts
ProductProfile {
  name
  description
  category
  targetCustomers[]
  problems[]
  benefits[]
  features[]
  differentiators[]
  useCases[]
  competitors[]
  proofPoints[]
  primaryCTA
  tone
  importantUrls { homepage, pricing, features[], docs }
}
```

The profile is workspace-scoped and editable. Users can correct any field.

## Exit criterion

A new workspace enters one URL. The system persists a complete, mostly
correct `ProductProfile` within a few minutes, without human input.

## Out of scope

- Crawling authenticated pages.
- Competitor research. RFC 026 covers external research.
- Continuous re-crawling. RFC 022 updates context from GitHub events.
