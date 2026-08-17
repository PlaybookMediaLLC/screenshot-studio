# RFC 022: GitHub Integration and Marketing-Worthy Change Detection

**Status:** Proposed
**Date:** 2026-08-17
**Depends on:** RFC 021
**Owners:** Engineering

## Decision

Connect GitHub and detect marketing-worthy merged PRs. Suggest campaigns.
Do not publish automatically. Shipping the product starts to create the raw
material for marketing the product.

## Design

Pipeline:

```text
Merged PR
   ↓
classify external relevance
   ↓
understand feature/change
   ↓
find corresponding ProductSurface
   ↓
update product context
   ↓
suggest campaign
```

Example:

```text
PR #452 merged: "Add recurring invoices"
        ↓
Marketing-worthy change detected.
        ↓
"Create feature launch?"
```

Details:

- A GitHub App delivers webhook events to the existing webhook
  infrastructure with signature verification.
- Classification is one schema-validated LLM call over the PR title, body,
  and changed paths. Internal-only changes are dropped.
- A detected change updates the `ProductProfile` and creates a suggestion,
  not a campaign. The founder accepts the suggestion to run Workflow 2
  (RFC 021).

## Exit criterion

A merged, externally meaningful PR produces the message "We noticed you
shipped X. Create a feature launch?" within minutes. Internal PRs produce
nothing.

## Out of scope

- Automatic screenshot capture from deployments. RFC 023 covers that.
- Automatic publishing.
