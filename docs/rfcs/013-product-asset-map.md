# RFC 013: Product Asset Map

**Status:** Proposed
**Date:** 2026-08-17
**Depends on:** RFC 012
**Owners:** Engineering

## Decision

Persist a map from product features to screens and captured assets. Call the
unit a `ProductSurface`. The future agent uses this map to pick the right
screen for a message instead of screenshotting the homepage at random.

## Context

Marketing a feature requires the screen that shows the feature:

```text
Product
├── Dashboard
│   ├── /dashboard
│   └── image asset
├── Invoice approvals
│   ├── /invoices/123
│   ├── invoice-table screenshot
│   └── approval-modal screenshot
└── Analytics
    ├── /analytics
    └── graph screenshot
```

## Data model

```ts
ProductSurface {
  id
  productId
  name
  url
  description
  featureIds[]
  screenshots[]
}
```

Screenshots reference existing workspace assets. Features reference
`ProductProfile.features`.

## Design

- Onboarding (RFC 012) seeds surfaces from discovered pages.
- Users can add, rename, and re-capture surfaces in the workspace UI.
- Capture of a surface is one call: `captureProductSurface(surfaceId)`. It
  uses the creative engine (RFC 010) and stores the asset against the surface.

## Exit criterion

Given "market the approvals feature", a lookup returns the approvals surface
and its captured screenshots without any LLM call.

## Out of scope

- Automatic surface discovery from app code or deployments. RFC 023 covers
  deployment-driven capture.
