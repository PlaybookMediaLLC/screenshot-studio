# RFC 010: Programmable Creative Engine

**Status:** Proposed
**Date:** 2026-08-17
**Depends on:** RFC 009
**Owners:** Engineering

## Decision

Expose the editor's capabilities as backend domain services. The UI, the
future agent, and the public API must call the same services. Do not start
with AI in this phase.

## Context

The editor already composes visuals, applies brand kits, and renders images
and video. These capabilities live behind the UI. The agent cannot use them,
and neither can recipes or background jobs.

## Design

Create canonical creative primitives, callable without the editor UI:

```ts
captureUrl()
captureElement()

createScreenshot()
createBrowserMockup()
createDeviceMockup()
createCarousel()
createComparison()
createAnnotatedScreenshot()
createAnimatedDemo()

applyBrandKit()

renderImage()
renderVideo()
```

Every call takes a `workspaceId` and validates input with Zod.

Architecture:

```text
UI
 │
 ├───────────────┐
 ▼               ▼
Creative API   Marketing Agent
      \           /
       \         /
        ▼       ▼
       Domain Services
            │
            ▼
      Rendering Engine
```

One implementation path prevents divergent AI, UI, and API behavior.

## Exit criterion

This call returns a production-ready asset without opening the editor:

```ts
await createBrowserMockup({
  workspaceId,
  url: 'https://acme.com/dashboard',
  browser: 'safari',
  background: 'gradient-12',
  padding: 64,
  shadow: 'soft',
})
```

## Out of scope

- Any LLM calls.
- New visual features. This phase only exposes what exists.
