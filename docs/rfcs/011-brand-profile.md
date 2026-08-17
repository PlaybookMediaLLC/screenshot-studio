# RFC 011: First-Class Brand Context

**Status:** Proposed
**Date:** 2026-08-17
**Depends on:** RFC 010
**Owners:** Product and Engineering

## Decision

Split brand context into two persisted objects:

- **Brand Kit** — visual identity. This exists today.
- **Brand Profile** — marketing identity. This is new.

Every generation call must implicitly know the workspace, product, brand, and
audience. The user must not repeat them.

## Data model

```text
BrandProfile
├── logo
├── colors
├── typography
├── tone
├── product description
├── audience
├── tagline
├── prohibited language
├── preferred visual styles
├── social handles
└── CTA conventions
```

The Brand Profile is workspace-scoped. It links to the existing Brand Kit for
visual values.

## Design

- Add a `BrandProfile` Prisma model with one profile per workspace initially.
- Add CRUD routes under the tenant API with the existing RBAC checks.
- Creative primitives (RFC 010) read the Brand Kit. Copy generation (later
  phases) reads the Brand Profile.
- Prohibited language becomes a hard filter on all generated copy.

## Exit criterion

A workspace stores a complete Brand Profile. A creative primitive call applies
the linked Brand Kit without explicit parameters.

## Out of scope

- Multiple brand profiles per workspace.
- Automatic brand extraction from the website. RFC 012 covers extraction.
