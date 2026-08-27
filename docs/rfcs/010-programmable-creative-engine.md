# RFC 010: Programmable Creative Engine

**Status:** Proposed
**Date:** 2026-08-17
**Revised:** 2026-08-26
**Depends on:** RFC 002, RFC 004, RFC 006, and RFC 009
**Owners:** Engineering

## Decision

Expose the editor's capabilities as backend domain services. The UI, the
future agent, and the public API must call the same services. Do not start
with AI in this phase.

The unit of work is a **creative spec**: a versioned, validated, serializable
document that fully determines a rendered output. A spec is authored by the
editor, by a recipe, by a REST client, or later by an agent. The renderer is a
pure function from spec plus resolved inputs to bytes.

## Context

The editor already composes visuals, applies brand kits, and renders images
and video. These capabilities live behind the UI. The agent cannot use them,
and neither can recipes or background jobs.

The specific obstacle is architectural, not conceptual. Today's rendering path
is:

```text
React canvas components → HTMLCanvasElement → canvas.toBlob()
        → POST /api/export → Sharp recompresses the bytes
```

`/api/export` is a compression endpoint. It receives finished pixels. The
server can shrink an image but cannot produce one. Video export runs entirely
in the browser through WebCodecs and FFmpeg WASM. There is no path by which a
Trigger.dev task or an agent tool call produces a rendered creative.

`CreativeVariant`, `CreativeTemplate`, and `BrandKit` already exist in the
tenant schema with versioning and approval. The persistence model is ready. The
rendering model is not. This RFC closes that gap.

## Goals

- One creative spec format shared by the editor, recipes, the API, and agents.
- Server-side rendering that does not require a browser session.
- Deterministic output: the same spec and inputs render identically.
- Full lineage from a rendered asset back to its spec, template, brand kit,
  and source capture.
- No behavioral divergence between what the UI produces and what the API
  produces.

## Non-goals

- Any LLM calls. This phase only exposes what exists.
- New visual features. Parity first; expansion later.
- Replacing the interactive editor. The editor stays the authoring surface.
- Real-time collaborative editing.
- Rendering arbitrary user-supplied HTML or JavaScript.

## Architecture

```text
   Editor UI          REST /api/v1          Recipes (015)        Agent (016)
       │                    │                     │                   │
       └────────────────────┴──────────┬──────────┴───────────────────┘
                                       ▼
                            Creative domain services
                              lib/tenant/creative
                                       │
                    ┌──────────────────┼──────────────────┐
                    ▼                  ▼                  ▼
              Spec validation    Input resolution    Render dispatch
              (Zod, versioned)   (assets, brand)     (sync or job)
                                                          │
                                       ┌──────────────────┴───────┐
                                       ▼                          ▼
                              Image renderer              Video renderer
                              (headless browser)          (frames + FFmpeg)
                                       │                          │
                                       └────────────┬─────────────┘
                                                    ▼
                                          Asset + R2 object
```

One implementation path prevents divergent AI, UI, and API behavior.

## The creative spec

A spec is a discriminated union on `kind`, carrying an explicit `specVersion`.

```ts
type CreativeSpec = {
  specVersion: 1
  kind: 'screenshot' | 'browserMockup' | 'deviceMockup'
      | 'carousel' | 'comparison' | 'annotated' | 'animatedDemo'
  canvas: {
    aspectRatio: '1:1' | '4:5' | '16:9' | '9:16' | '1.91:1'
    scale: 1 | 2 | 3          // export multiplier, capped at 3 server-side
  }
  background: BackgroundSpec   // solid | gradient | image | pattern
  brandKitId?: string          // resolved to a pinned version at render time
  layers: LayerSpec[]          // ordered, bottom to top
  timeline?: TimelineSpec      // required when kind is animatedDemo
}
```

Rules that make the spec safe to accept from any caller:

1. **Assets are referenced, never inlined.** A layer names an `assetId` or a
   `captureId`. It never carries base64 bytes or a remote URL. The resolver
   loads the asset from the tenant's own storage and refuses any asset outside
   the organization. This removes SSRF and data-exfiltration surface from the
   spec entirely.
2. **No executable content.** No HTML strings, no CSS strings, no expressions,
   no font URLs. Backgrounds, frames, and effects are enumerated identifiers
   resolved against a server-side registry.
3. **Bounded size.** At most 32 layers, at most 10 carousel slides, at most 32
   timeline steps, and a 256 KB serialized spec limit.
4. **Text is data.** Text layers carry a string, a token-referenced style, and
   a position. Text is escaped at render, never interpolated into markup.
5. **Unknown fields are rejected.** Strict Zod parsing, so a client cannot
   smuggle renderer options.

The spec is stored as `CreativeTemplate.definition` when reusable, and inline
on the render request when one-off. `CreativeVariant` already pins
`templateId`, `templateVersion`, `brandKitId`, and `brandKitVersion`, so a
rendered variant is reproducible after templates and kits move on.

## Service surface

Every call takes a `workspaceId` and validates input with Zod.

### Capture

```ts
captureUrl({ workspaceId, url, viewport, waitFor, fullPage }): Promise<Capture>
captureElement({ workspaceId, url, selector, viewport }): Promise<Capture>
```

Both delegate to the existing capture path with its SSRF guards, private-network
rejection, redirect-escape rejection, and size limits. They create `Capture` and
`Asset` rows so downstream creatives reference stored bytes.

### Compose

Composition builds a spec. It does not render.

```ts
createScreenshot(input): CreativeSpec
createBrowserMockup(input): CreativeSpec
createDeviceMockup(input): CreativeSpec
createCarousel(input): CreativeSpec
createComparison(input): CreativeSpec
createAnnotatedScreenshot(input): CreativeSpec
createAnimatedDemo(input): CreativeSpec
```

These are pure functions with no I/O. They are the ergonomic front door: a
caller supplies a handful of meaningful arguments and receives a complete,
valid spec. They are individually unit-testable without a database, a browser,
or a network.

### Brand

```ts
applyBrandKit({ workspaceId, spec, brandKitId }): CreativeSpec
```

Resolves brand tokens into concrete values and pins the kit version into the
spec. Applying a kit twice is idempotent. Explicit values in the spec win over
kit defaults, so an agent can override one color without abandoning the kit.

### Render

```ts
renderImage({ workspaceId, spec, format, releaseId? }): Promise<RenderResult>
renderVideo({ workspaceId, spec, format, releaseId? }): Promise<RenderHandle>
```

`renderImage` is synchronous for specs under the fast-path budget and returns
a completed `Asset`. `renderVideo` always returns a handle to a Trigger.dev run.

### Persist

```ts
createCreativeVariant({ workspaceId, releaseId, spec, aspectRatio, ... })
```

This already exists. Rendering produces an `Asset`; variant creation binds that
asset to a release with pinned template and brand-kit versions, and the
approval workflow in RFC 019 takes over from there.

## Rendering

### Image rendering

Server-side image rendering uses a headless Chromium instance that loads an
internal render route, hydrates the same React canvas components the editor
uses, waits for a fonts-and-images-settled signal, and screenshots the canvas
element. Sharp then encodes to the requested format, reusing `/api/export`'s
existing encoder configuration.

Reusing the editor's own components is the decision that guarantees parity. A
second, server-only compositor would be faster to build and would diverge from
the editor within one sprint. Divergence between "what the founder sees in the
editor" and "what the agent published" is the failure mode that destroys trust
in the product, so parity outranks performance here.

The internal render route is service-authenticated, never publicly routable,
and accepts only a spec ID plus a signed token. It never accepts a raw spec
from an untrusted caller.

### Video rendering

Video renders as frames plus encoding, always as a Trigger.dev task:

1. Resolve the timeline into discrete frames at a fixed frame rate.
2. Render frames in bounded batches through the same headless pipeline.
3. Encode with FFmpeg to MP4, WebM, or GIF.
4. Upload to R2 and create the `Asset`.

The browser's WebCodecs path stays for interactive editor export, where it is
faster and free. The server path exists for headless callers. Both must produce
visually equivalent output for the same spec, verified by the parity test below.

### Determinism

Deterministic output requires controlling every source of variation:

| Source              | Control                                                       |
| ------------------- | ------------------------------------------------------------- |
| Fonts               | Bundled font files only; no network font loading; fixed subset |
| Time and dates      | Injected fixed clock; no `Date.now()` in render code           |
| Randomness          | Seeded from the spec hash; noise and pattern effects are seeded |
| Animation timing    | Frame index, never wall-clock elapsed time                     |
| Image decoding      | Pinned Chromium and Sharp versions in the render image         |
| Device scale        | Explicit `deviceScaleFactor`, never inferred                   |

A `rendererVersion` is stored on every produced asset. When the renderer
changes in a way that alters output, the version increments. This makes
"why does this look different now" answerable from data.

Determinism enables content-addressed caching: the cache key is
`sha256(canonicalSpec + resolvedInputHashes + rendererVersion)`. A repeated
render of an unchanged spec returns the existing asset without re-rendering.
Recipes and agents regenerate specs frequently, so this is a meaningful cost
control, not a micro-optimization.

## Synchronous versus asynchronous

| Condition                                      | Path         | Budget         |
| ---------------------------------------------- | ------------ | -------------- |
| Single-frame image, scale ≤ 2, ≤ 8 layers       | Synchronous  | 10s p95        |
| Cache hit on the content-addressed key          | Synchronous  | 200ms p95      |
| Carousel with more than 4 slides                | Asynchronous | 60s p95        |
| Scale 3 or canvas above 4096px on a side        | Asynchronous | 60s p95        |
| Any video                                       | Asynchronous | 5 min p95      |

A synchronous request that exceeds its budget does not fail. It converts to a
job and returns `202` with a handle, so a slow render degrades into a queued
render rather than a timeout. Callers therefore always handle both shapes:

```ts
type RenderResult =
  | { status: 'completed'; asset: Asset; cached: boolean }
  | { status: 'queued'; handle: { runId: string; renderId: string } }
```

## Idempotency

Render requests accept an idempotency key. The service also computes the
content-addressed key described above. Behavior:

- Same idempotency key, in-flight: return the existing handle.
- Same idempotency key, completed: return the original asset.
- Different idempotency key, identical content key: return the cached asset
  with `cached: true`.
- Content key differs: render.

`force: true` bypasses the content cache but not the idempotency key, so a
retried request never renders twice while a genuine regeneration always can.

## Authorization

| Operation                | Session permission | API-key scope     |
| ------------------------ | ------------------ | ----------------- |
| `captureUrl`, `captureElement` | `release:create` | `source:write`  |
| Compose functions        | none (pure)        | none              |
| `applyBrandKit`          | `artifact:read`    | `artifact:read`   |
| `renderImage`, `renderVideo` | `artifact:edit` | `asset:write`     |
| `createCreativeTemplate` | `brand:manage`     | not permitted     |
| `createCreativeVariant`  | `artifact:edit`    | `asset:write`     |

Every asset, capture, brand kit, and template referenced by a spec is verified
to belong to the caller's organization during input resolution, before any
render begins. A spec referencing a foreign asset fails with `404`, not `403`.

Rendering is metered. It requires a new `creative:render` workspace feature,
which does not exist yet: `workspaceFeatureSchema` in `lib/billing/plans.ts`
currently enumerates asset, release, source-app, and enterprise features only.
Adding it is a prerequisite of this RFC, not an assumption of it. Rendering then
consumes the existing `generation:monthly` quota from the entitlement model in
RFC 034. Video consumes more quota than images, proportional to rendered frames.

## Failure behavior

| Failure                          | Code                     | Retry     | Caller behavior                |
| -------------------------------- | ------------------------ | --------- | ------------------------------ |
| Spec fails validation            | `invalid_creative_spec`  | no        | Fix the spec; issues returned  |
| Referenced asset missing         | `asset_not_found`        | no        | Re-capture or re-reference     |
| Referenced asset not readable    | `asset_unavailable`      | yes       | Transient storage failure      |
| Brand kit version archived       | `brand_kit_unavailable`  | no        | Choose an active kit           |
| Render browser crash             | `render_failed`          | yes, 3×   | Automatic with backoff         |
| Render timeout                   | `render_timeout`         | yes, 1×   | Converts to a job              |
| Output exceeds size limit        | `render_too_large`       | no        | Reduce scale or dimensions     |
| Quota exhausted                  | `quota_exceeded`         | no        | `429` with `Retry-After`       |
| Font or effect not in registry   | `unknown_render_token`   | no        | Fix the spec                   |

Renders are cancellable while queued or running. Cancellation stops frame
production, releases the browser slot, and marks the render `CANCELLED`.
Partial frames are discarded; a cancelled video never produces a partial file.

Every render failure records the spec hash, the renderer version, and the
failing stage. Reproducing a customer's failed render must not require asking
the customer for anything.

## Resource limits

Headless browsers are the expensive resource, so limits are explicit:

- A bounded browser pool with a fixed concurrency per worker.
- A hard 60-second wall-clock cap per frame; exceeding it kills the browser.
- A per-workspace concurrent-render cap so one tenant cannot starve others.
- Memory-capped browser processes, restarted after a fixed render count to
  bound leaks.
- A queue depth limit; beyond it, new renders are rejected with `503` and
  `Retry-After` rather than being accepted into an unbounded backlog.

## Spec versioning and migration

`specVersion` is required. The service accepts the current version and the
previous one, upgrading old specs through pure migration functions on read.
Stored template definitions are migrated lazily and rewritten on next save.

A spec version is retired only after every stored template has been migrated,
verified by a migration audit query. Rendering a retired version returns
`unsupported_spec_version` rather than rendering something approximate.

## Observability

| Signal                     | Dimensions                          | Why it is collected                          |
| -------------------------- | ----------------------------------- | -------------------------------------------- |
| `creative.render.duration` | mode, layer count, scale, cache hit | Confirms the latency budgets above hold      |
| `creative.render.outcome`  | outcome, error code                 | Separates bad specs from engine faults       |
| `creative.cache.hit_rate`  | key prefix                          | Cache misses are the main cost driver        |
| `creative.spec.version`    | version, migrated                   | Shows when a version is safe to retire       |

**The metric that actually matters: synchronous render p95 against its budget.**
The engine promises 10 seconds at p95 for a single-frame image, and the whole
synchronous path exists only because that promise holds. When it slips, callers
that were written to render inline start blocking a user-visible request, so
the correct response is to move the offending shape to the asynchronous path
rather than to raise the budget.

Render failures are logged with the spec hash rather than the full spec. Specs
can carry customer copy, and a hash is enough to reproduce a fault from stored
template definitions.

## Rollout

1. **Spec and composition.** Define the Zod schema and the compose functions.
   Ship with unit tests and no renderer. Nothing user-visible changes.
2. **Editor adopts the spec.** The editor serializes its canvas state to a
   spec and restores from one. This proves the spec is expressive enough
   against the real authoring surface, which is the phase most likely to
   surface a missing field.
3. **Headless image renderer.** Ship behind a flag. Run the parity harness.
4. **Parity gate.** For a fixed corpus of specs covering every `kind`, every
   aspect ratio, and both light and dark frames, render in-browser and
   server-side and compare. Require a perceptual difference below a fixed
   threshold on every case. Do not proceed while any case fails.
5. **Service surface.** Expose render through tRPC and `/api/v1`.
6. **Video renderer.** Ship behind a flag; extend the parity harness to a
   frame-sampled comparison.
7. **Recipes and agent adopt it.** RFC 015 and RFC 016 call the same services.

Rollback at any step is a flag flip back to editor-only rendering. Specs
already written remain valid because they are data.

## Acceptance criteria

1. `createBrowserMockup` followed by `renderImage` produces a production-ready
   asset with no browser session and no editor involvement:

   ```ts
   const spec = createBrowserMockup({
     workspaceId,
     url: 'https://acme.com/dashboard',
     browser: 'safari',
     background: 'gradient-12',
     padding: 64,
     shadow: 'soft',
   })
   const { asset } = await renderImage({ workspaceId, spec, format: 'png' })
   ```

2. Rendering the same spec twice returns the same asset with `cached: true`
   and does not invoke the renderer.
3. The parity corpus renders identically in-browser and server-side within
   the perceptual threshold for every case.
4. Rendering the same spec 10 times across worker restarts produces 10
   byte-identical outputs.
5. A spec referencing an asset from another organization fails with `404`.
6. A spec containing an inline URL or HTML string fails validation.
7. A 33-layer spec fails validation with a bounded-size error.
8. A synchronous render exceeding its budget returns `202` with a handle
   rather than timing out.
9. A cancelled video render produces no asset and releases its browser slot.
10. A workspace at its generation quota receives `429` with `Retry-After`.
11. A killed render worker leaves no orphaned browser process and the render
    is retried.
12. An editor-authored canvas round-trips through the spec with no visible
    difference.

## Out of scope

- Any LLM calls.
- New visual features. This phase only exposes what exists.
- Authenticated page capture. That gap needs its own RFC and is a dependency
  of RFC 023.
