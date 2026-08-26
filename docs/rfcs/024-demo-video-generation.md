# RFC 024: Product Demo Video Generation

**Status:** Proposed
**Date:** 2026-08-17
**Revised:** 2026-08-26
**Depends on:** RFC 010 and RFC 023
**Owners:** Engineering

## Decision

Generate short product demo videos from captured workflows. Build this only
after static screenshot campaigns work. The existing animation and video
rendering makes this a natural extension, not a new engine.

A demo is a `TimelineSpec`, which is the `animatedDemo` variant of the creative
spec from RFC 010. It is data, versioned and validated like every other spec,
and it renders through the same server pipeline.

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

## Goals

- A branded, captioned demo from an ordered set of captures, with no editor work.
- Deterministic rendering, so a re-render is byte-identical.
- Bounded compute, so one video cannot consume a worker indefinitely.
- Output that a founder can open in the editor and adjust.

## Non-goals

- Voice-over and music.
- Demos longer than about 30 seconds.
- Screen recording of live interaction. Scenes come from discrete captures.
- Automatic script writing beyond short captions.

## Timeline schema

```ts
TimelineSpec {
  specVersion: 1
  fps: 30                       // fixed
  durationMs                    // derived from scenes, ≤ 30000
  aspectRatio: '16:9' | '9:16' | '1:1' | '4:5'
  scenes: Scene[]               // 2-8
  intro?: TitleCard
  outro?: CtaCard
  frame?: FrameToken            // browser or device chrome
  background: BackgroundSpec
}

Scene {
  id
  captureId                     // a SurfaceCapture from RFC 013
  durationMs                    // 800-6000
  caption?: { text, position, style }   // ≤ 60 chars
  focus?: { x, y, width, height }       // region to emphasize
  motion: 'none' | 'kenBurns' | 'zoomIn' | 'zoomOut' | 'pan'
  cursor?: { fromX, fromY, toX, toY, clickAtMs }
  transitionIn: 'cut' | 'fade' | 'slide' | 'push'
}
```

Constraints that keep rendering bounded and output watchable:

- 2 to 8 scenes; a one-scene video is an image and a nine-scene video is a
  tutorial.
- Total duration 3 to 30 seconds.
- Fixed 30 fps, so a 30-second maximum is 900 frames.
- Captions capped at 60 characters, because longer text is unreadable at social
  playback sizes.
- All scenes share one aspect ratio.
- Every `captureId` must resolve to an asset in the caller's workspace.

## Scene derivation

`createAnimatedDemo` (RFC 010) accepts an ordered list of captures or a
recorded interaction and produces a timeline. Derivation is deterministic:

1. Order captures by their position in the supplied sequence.
2. Assign durations from caption length, with a floor and a ceiling, so a
   scene with text stays on screen long enough to read.
3. Derive the focus region from the perceptual difference between consecutive
   captures. The region that changed is the region worth zooming into, and it
   is computable without a model.
4. Derive cursor motion from the focus region of the following scene: the
   cursor moves toward what is about to change.
5. Choose transitions by scene relationship: a cut within a screen, a fade
   across screens.

Captions may be model-generated from the campaign angle and the surface names,
schema-validated and length-checked. Everything else about the timeline is
computed. A model choosing frame timings would produce videos that differ on
every render and cannot be cached.

## Rendering

Rendering reuses the editor's animation presets, browser frames, and video
export (MP4, WebM, GIF). Renders run as Trigger.dev jobs. Video is slow;
nothing blocks a request.

Pipeline:

```text
Validate spec
   ↓
Resolve captures and brand context
   ↓
Compute the frame plan            deterministic, frame-indexed
   ↓
Render frames in batches          headless pipeline (RFC 010)
   ↓
Encode with FFmpeg                MP4 / WebM / GIF
   ↓
Generate a poster frame
   ↓
Upload; create the Asset
```

### Formats

| Format | Codec        | Use                    | Notes                                |
| ------ | ------------ | ---------------------- | ------------------------------------ |
| MP4    | H.264 + AAC-silent | X, LinkedIn      | Broadest compatibility; faststart    |
| WebM   | VP9          | Web embed              | Smaller; poorer social support        |
| GIF    | palette-quantized | Fallback preview  | Large; cap at 10 seconds             |

MP4 is the default. Social platforms often require an audio track even for a
silent video, so MP4 carries a silent AAC track. Discovering that at publish
time would be an unpleasant failure.

A poster frame is always produced, since most social previews show a still
before playback.

### Determinism

The RFC 010 determinism rules apply, plus:

- Frames are indexed, never wall-clock timed. Frame `n` is a pure function of
  the spec and `n`.
- Easing curves are fixed functions, not physics simulations.
- Encoder settings are pinned; FFmpeg and its libraries are pinned in the
  render image.
- Encoding is single-pass with fixed parameters, so it does not vary with
  machine load.

Determinism makes the content-addressed cache from RFC 010 apply to video,
which matters more here than for images because video is the expensive path.

## Compute limits

| Limit                          | Value                          |
| ------------------------------ | ------------------------------ |
| Maximum frames                 | 900 (30s at 30fps)             |
| Frame render timeout           | 10 seconds                     |
| Total render wall clock        | 10 minutes                     |
| Encoding timeout               | 5 minutes                      |
| Concurrent video renders/workspace | 1                          |
| Output file size               | 100 MB, checked before upload  |
| Frame batch size               | Bounded; the browser restarts between batches |

Frames render in batches with a checkpoint after each, so a crashed render
resumes rather than restarting. Rendering 700 frames and losing them to a
worker restart is the failure this prevents.

Rendered frames are held in ephemeral storage and deleted after encoding, on
success or failure.

## Cancellation

Cancellable at any stage:

- Queued: removed, nothing rendered.
- Rendering: stops after the current frame batch, frames discarded.
- Encoding: FFmpeg terminated, partial output discarded.
- Uploading: upload aborted, partial object removed.

A cancelled render never produces a partial or corrupt asset. Video is
partially useful in a way images are not, which makes it tempting to keep a
truncated file; a truncated demo published to LinkedIn is worse than none.

## Storage and retention

- Videos are stored in the private tenant bucket alongside other assets.
- The poster frame is a separate `Asset` derived from the video.
- Intermediate frames are never persisted to tenant storage.
- Unused video assets follow the standard retention policy; videos referenced
  by a `CreativeVariant` are retained like any other referenced asset.
- Video counts against storage quota at its actual byte size, which is roughly
  an order of magnitude larger than an image and should be visible in usage
  reporting.

## Recovery

| Failure                   | Behavior                                          |
| ------------------------- | ------------------------------------------------- |
| Frame render fails        | Retry that frame twice, then fail the render      |
| Browser crash mid-batch   | Restart the browser, resume from the checkpoint   |
| Encoder fails             | Retry once with conservative settings, then fail  |
| Output exceeds size limit | Retry once at lower bitrate, then fail            |
| Upload fails              | Retry with backoff, then fail                     |
| Worker crash              | Trigger.dev resumes from the last frame checkpoint |
| Capture asset missing     | Fail before rendering any frame                   |

A failed video never blocks its campaign. The post keeps its static creative
and offers an inline retry, matching the RFC 018 failure pattern.

## Brand and accessibility

Brand background and CTA come from the Brand Kit and Brand Profile (RFC 011).
Logo placement respects the kit's clear-space and minimum-width rules.

Accessibility requirements, because these videos are published publicly:

- Captions are rendered into the video, since most social playback is muted.
- Caption contrast meets the RFC 011 contrast rules against the frame behind
  them, measured per frame region.
- Motion is bounded: no strobing, and no rapid full-frame flashing.
- A caption transcript is stored with the asset for use as alt text or a
  platform caption field.

## Security threats

Video generation drives a real browser through a customer's product, which
makes it the most powerful capture primitive in the platform and the one most
able to record something it should not.

| Threat                                    | Mitigation                                                    |
| ----------------------------------------- | ------------------------------------------------------------- |
| Recording authenticated or private state  | Capture runs unauthenticated; `requiresAuth` surfaces are skipped |
| Internal network reachable from the browser | Same SSRF denylist as every other capture path                |
| Real customer data appearing in a frame   | Only public surfaces are recorded; frames are workspace-scoped   |
| Rendered video readable across tenants    | Storage keys are workspace-scoped and served through signed URLs |
| Cost exhaustion through repeated renders  | Per-render and per-workspace budgets; exhaustion fails the job   |

The narrow rule is that this pipeline never authenticates. Authenticated
capture is a named gap in the README precisely because doing it safely is a
separate problem, and a video pipeline that quietly grew a login step would
solve that problem in the least reviewable place in the product.

## Authorization

| Operation           | Session permission | API-key scope |
| ------------------- | ------------------ | ------------- |
| Create a demo spec  | `artifact:edit`    | `asset:write` |
| Render a video      | `artifact:edit`    | `asset:write` |
| Cancel a render     | `artifact:edit`    | `asset:write` |
| Open in the editor  | `artifact:edit`    | not applicable |

Video rendering is metered under the `creative:render` workspace feature that
RFC 010 introduces, with a higher `generation:monthly` cost proportional to
frame count. Every referenced capture is verified to belong to the workspace
before rendering starts.

## Observability

- Render duration by frame count, at p50 and p95.
- Frames per second of render throughput.
- Failure rate by stage: frame, encode, upload.
- Cache hit rate on repeat renders.
- Output size distribution.
- Cost per video, which sizes the quota.
- Share of campaigns including a video, and their approval rate versus
  static-only campaigns.

The last one decides whether the feature earns its cost. Video is the most
expensive artifact in the product, and it should demonstrably outperform a
static creative.

## Acceptance criteria

1. A three-step captured workflow renders into a branded, captioned
   10-second MP4 without manual editor work.
2. Rendering the same spec twice returns the cached asset with no re-render.
3. Two renders of the same spec produce byte-identical output.
4. A spec with 9 scenes or above 30 seconds fails validation.
5. A spec referencing a foreign capture fails with `404`.
6. A worker crash at frame 400 resumes from the checkpoint.
7. A cancelled render produces no asset and no partial object.
8. A failed video leaves the campaign post intact with a retry action.
9. The MP4 carries a silent audio track and plays on X and LinkedIn.
10. A poster frame is produced and linked to the video.
11. Captions meet contrast requirements against their backgrounds.
12. Output exceeding the size limit retries once at a lower bitrate.
13. Intermediate frames are deleted after both success and failure.
14. A rendered video opens in the editor and can be adjusted by hand.
15. Video consumes proportionally more render quota than an image.

## Rollout

1. Extend the RFC 010 spec with `TimelineSpec` and validate it. Ship the
   editor's animation export against the same schema.
2. Ship the server frame renderer for a single-scene timeline; verify parity
   against the browser export.
3. Add multi-scene, transitions, and motion.
4. Add captions, cursor, and CTA.
5. Add scene derivation from RFC 023 captures.
6. Enable in campaigns behind a flag; measure cost and approval lift.

Every launch can then produce a screenshot, a carousel, a GIF, and an MP4
from the same source material.

## Out of scope

- Voice-over and music.
- Demos longer than about 30 seconds.
