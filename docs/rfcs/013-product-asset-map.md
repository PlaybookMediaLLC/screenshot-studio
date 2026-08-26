# RFC 013: Product Asset Map

**Status:** Partially implemented (`ProductSurface` model and tRPC router exist; capture binding and freshness do not)
**Date:** 2026-08-17
**Revised:** 2026-08-26
**Depends on:** RFC 010 and RFC 012
**Owners:** Engineering

## Decision

Persist a map from product features to screens and captured assets. Call the
unit a `ProductSurface`. The future agent uses this map to pick the right
screen for a message instead of screenshotting the homepage at random.

Surface lookup must be a database query, not an LLM call. The agent asks "which
screen shows approvals" and receives an answer with no inference, no latency,
and no possibility of hallucinating a URL.

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

`ProductSurface` ships with `name`, `url`, `description`, `featureTags`, and
`screenshotAssetIds` as JSON, unique on `(organizationId, name)`. The model
exists. What is missing is the capture binding, the freshness model, and the
lookup contract that makes it useful to a generator.

## Goals

- A deterministic feature-to-screen lookup with no model involvement.
- Screenshots that are known-fresh, or known-stale and labeled as such.
- Lineage from a published post back to the exact capture it used.
- Safe re-capture that never silently replaces an approved asset.

## Non-goals

- Automatic surface discovery from app code. RFC 023 covers deployment-driven
  capture.
- Authenticated capture. That needs its own RFC and blocks most real product
  screens.
- Visual regression testing. Similar mechanics, different product.
- Surface hierarchy or nesting beyond tags.

## Data model

```ts
ProductSurface {
  id
  workspaceId
  name                  // unique per workspace, human-readable
  slug                  // stable, URL-safe, immutable after creation
  url                   // absolute, same-origin as the product domain
  description
  featureTags[]         // free tags plus ProductProfile.features references
  requiresAuth          // capture is blocked until authenticated capture ships
  captureRecipeId?      // viewport, wait, selector, masks
  status                // active | stale | broken | archived
  lastCapturedAt
  lastCaptureFailureCode
  createdAt
  updatedAt
}

SurfaceCapture {
  id
  workspaceId
  surfaceId
  assetId               // the raw capture
  captureId             // the Capture row
  contentHash           // perceptual hash of the image
  viewport              // { width, height, deviceScaleFactor }
  capturedAt
  supersededAt          // non-null once a newer capture exists
  isBaseline            // marks the before image for comparisons
}
```

Replacing `screenshotAssetIds` JSON with a `SurfaceCapture` table is the
central change. A JSON array of IDs cannot express when a capture was taken,
which viewport it used, whether it superseded another, or whether it is the
baseline for a before-and-after. Those are exactly the questions a
before-and-after creative needs answered.

## Identity and deduplication

- A surface is identified by `slug`, which is stable across renames. Campaign
  posts and creative specs reference the slug, so renaming "Invoices" to
  "Billing" does not break existing references.
- `(workspaceId, normalizedUrl)` is unique. Creating a surface at an existing
  URL returns the existing surface rather than creating a duplicate. URL
  normalization lowercases the host, strips the fragment, sorts query
  parameters, and removes tracking parameters.
- Captures deduplicate by perceptual hash. A re-capture producing a
  visually-identical image reuses the existing asset and updates
  `lastCapturedAt` only. This matters because re-capture runs on every
  deployment in RFC 023 and most deployments change nothing visible.

## Capture

One call captures a surface:

```ts
captureProductSurface({ workspaceId, surfaceSlug, force? }): Promise<SurfaceCapture>
```

It resolves the surface, applies the capture recipe, calls RFC 010's
`captureUrl` with its SSRF guards, stores the asset, computes the perceptual
hash, and creates the `SurfaceCapture`. It is idempotent within a short window:
two concurrent captures of one surface produce one capture.

Capture recipes control the variables that make screenshots unstable:

```ts
CaptureRecipe {
  viewport: { width, height, deviceScaleFactor }
  waitFor: 'load' | 'networkidle' | { selector: string } | { ms: number }
  clipSelector?: string        // capture one element
  hideSelectors?: string[]     // cookie banners, chat widgets
  maskSelectors?: string[]     // solid-fill regions with volatile content
  scrollTo?: number
  colorScheme: 'light' | 'dark'
  reducedMotion: true          // always, for stability
}
```

`maskSelectors` is what makes captures comparable over time. Timestamps,
notification counts, and "last updated 3 minutes ago" change on every capture
and would defeat perceptual deduplication and make every before-and-after
comparison look like a change.

`requiresAuth` surfaces are stored and never captured. They return
`capture_requires_auth` and remain useful as a map even while unshootable. This
is honest about the largest gap: most interesting product screens are behind a
login, and RFC 023 depends on solving it.

## Replacement semantics

New captures never destroy old ones.

- A new capture supersedes the previous one by setting `supersededAt`.
- Superseded captures remain readable and remain referenced by any creative
  built from them.
- A `CreativeVariant` references a specific `assetId`, so an approved creative
  is never altered by a re-capture. This is required by RFC 019: content
  approved by a human must not change after approval.
- The "current" capture for a surface is the newest non-superseded one.
- A baseline capture is pinned explicitly and is not superseded automatically,
  because before-and-after needs a stable "before".

## Freshness

Each surface carries a computed freshness state:

| State     | Condition                                                  |
| --------- | ---------------------------------------------------------- |
| `fresh`   | Captured within 30 days and the last capture succeeded      |
| `stale`   | Older than 30 days, or the source deployed since capture    |
| `broken`  | The last two capture attempts failed                        |
| `unknown` | Never captured                                              |

Freshness is advisory, not blocking. A generator may use a stale capture and
must surface the staleness to the founder, who is the only one who knows
whether the screen actually changed. Refusing to generate from a 31-day-old
screenshot would be worse than generating with a label.

## Lookup contract

The lookup that makes the map worth building:

```ts
findSurfacesForFeature({ workspaceId, feature, limit }): SurfaceMatch[]
```

Matching is deterministic and ordered:

1. Exact `featureTags` match against a `ProductProfile.features` entry.
2. Exact slug or name match, case-insensitive.
3. Token overlap between the feature string and the surface name, description,
   and tags, scored and thresholded.
4. Fallback to the homepage surface, explicitly labeled as a fallback.

No LLM call at any step. Each result carries its match reason and score, so
"why did you pick this screen" is answerable. A generator that receives only a
fallback match should say "I could not find a screen for that feature" rather
than confidently marketing a homepage screenshot as a feature screen.

## Authorization

| Operation                | Session permission | API-key scope   |
| ------------------------ | ------------------ | --------------- |
| List and read surfaces   | `workspace:read`   | `artifact:read` |
| Create or update         | `release:create`   | `source:write`  |
| Capture                  | `release:create`   | `source:write`  |
| Archive                  | `release:create`   | `source:write`  |
| Set a baseline           | `artifact:edit`    | not permitted   |

Surface URLs are validated against the workspace's registered product hosts on
create and again on capture. A surface cannot point at an arbitrary third-party
site, which prevents the surface map from becoming a general-purpose
screenshot proxy that bypasses capture rate limits.

## Retention

- Superseded captures are retained for 90 days by default, then their assets
  are deleted while the `SurfaceCapture` metadata row remains as lineage.
- Captures referenced by any `CreativeVariant` are never deleted, regardless of
  age. Approved and published content must stay reproducible.
- Baseline captures are never auto-deleted.
- Archiving a surface retains its captures; deleting a workspace deletes all
  of them.

## Failure behavior

| Failure                          | Code                       | Surface effect                 |
| -------------------------------- | -------------------------- | ------------------------------ |
| URL unreachable                  | `surface_unreachable`      | Failure recorded; `broken` at 2 |
| Capture timeout                  | `capture_timeout`          | Failure recorded; retried once |
| Auth wall detected               | `capture_requires_auth`    | `requiresAuth` set, run stops  |
| URL now off the product host     | `surface_host_rejected`    | `broken`, no capture attempted |
| Selector not found               | `capture_selector_missing` | Full-page fallback, warned     |
| Storage failure                  | `asset_unavailable`        | Retried; surface unchanged     |

A broken surface is visible in the workspace with its failure code. Silent
capture failure is the worst outcome, because a campaign then generates against
a screenshot that is months old with no signal.

## Observability

- Surfaces by freshness state per workspace.
- Capture success rate and duration at p50 and p95.
- Perceptual-dedup hit rate, which measures wasted capture work.
- Lookup outcomes by match reason, and the share resolving only to fallback.
- Count of `requiresAuth` surfaces, which sizes the authenticated-capture gap.

Fallback share is the product metric. A workspace where most lookups fall back
to the homepage has a surface map that is not doing its job.

## Acceptance criteria

1. Given "market the approvals feature", a lookup returns the approvals
   surface and its captured screenshots with no LLM call.
2. Every match carries a reason and a score.
3. A feature with no matching surface returns a labeled fallback, never a
   confident wrong answer.
4. Creating a surface at an existing normalized URL returns the existing one.
5. Re-capturing an unchanged screen reuses the asset and updates only
   `lastCapturedAt`.
6. A re-capture does not alter any existing `CreativeVariant`.
7. Renaming a surface does not break references made through its slug.
8. A surface URL outside the workspace's product hosts is rejected.
9. A login-walled surface records `capture_requires_auth` and does not retry
   indefinitely.
10. Masked regions are excluded from the perceptual hash, so a clock change
    does not produce a new capture.
11. Two failed captures move a surface to `broken` and expose it in the UI.
12. A capture referenced by an approved variant is not deleted by retention.
13. Two concurrent captures of one surface produce one capture.

## Rollout

1. Add `SurfaceCapture` and migrate `screenshotAssetIds` into rows.
2. Ship `captureProductSurface` and capture recipes.
3. Ship the lookup with match reasons; instrument fallback share.
4. Seed surfaces from RFC 032 onboarding.
5. Ship freshness and retention.
6. Ship baselines when RFC 023 needs before-and-after.

## Out of scope

- Automatic surface discovery from app code or deployments. RFC 023 covers
  deployment-driven capture.
- Authenticated capture.
