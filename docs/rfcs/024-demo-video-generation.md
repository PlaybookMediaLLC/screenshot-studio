# RFC 024: Product Demo Video Generation

**Status:** Proposed
**Date:** 2026-08-17
**Depends on:** RFC 023
**Owners:** Engineering

## Decision

Generate short product demo videos from captured workflows. Build this only
after static screenshot campaigns work. The existing animation and video
rendering makes this a natural extension, not a new engine.

## Design

Input — a captured workflow:

```text
Dashboard
   ↓
Click invoices
   ↓
Click approve
   ↓
success
```

Output:

```text
10-second MP4
```

With:

```text
zoom
cursor
captions
transitions
browser frame
brand background
CTA
```

Details:

- `createAnimatedDemo` (RFC 010) accepts an ordered list of captures or a
  recorded interaction and produces a timeline.
- Rendering reuses the editor's animation presets, browser frames, and video
  export (MP4, WebM, GIF).
- Brand background and CTA come from the Brand Kit and Brand Profile
  (RFC 011).
- Renders run as Trigger.dev jobs. Video is slow; nothing blocks a request.

Every launch can then produce a screenshot, a carousel, a GIF, and an MP4
from the same source material.

## Exit criterion

A three-step captured workflow renders into a branded, captioned 10-second
MP4 without manual editor work.

## Out of scope

- Voice-over and music.
- Demos longer than about 30 seconds.
