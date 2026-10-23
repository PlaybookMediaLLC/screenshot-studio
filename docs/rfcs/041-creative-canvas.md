# RFC 041: Creative Canvas

> **Roadmap disposition (2026-10-23):** Maintain and reuse the implemented canvas. Additional general-purpose canvas work is not on the release-readiness critical path.
> See the [current execution order](README.md). Older decision text is
> historical wherever it conflicts with that order or the audited architecture.

**Status:** Implemented locally; end-to-end, unit and Go checks pass on a local stack; not deployed

**Date:** 2026-10-20

**Owners:** Product Engineering

**Depends on:** RFC 010, RFC 014, RFC 018, RFC 040

## Decision

Canvas is a primary sidebar destination where a team lays out a whole launch
on one infinite board. The board holds finite artboards. Each artboard is a
complete native `DesignDocument` placed at a workspace position, edited by the
existing screenshot editor and rendered by the existing renderer. There is no
new scene graph and no third renderer.

A canvas is stored as a creative set of kind `canvas`. It reuses the Story Set
lifecycle in the Go backend: revision-checked writes, autosave checkpoints,
named versions, restore, duplicate, archive, asset retention and campaign
handoff. Existing projects, Story Sets and campaign designs open on a canvas as
lossless copies pinned to what was copied; the sources are never written.

## Audit

Audited on 2026-10-20 from `1c46737d`, by reading the code and by driving the
running application in Chromium on a local stack (Postgres, Redis, RustFS, the
Go backend and `next dev` on Turbopack).

| Capability | State before this work | Notes |
| --- | --- | --- |
| Canvas navigation | Not implemented | The editor shows one fixed-size stage that fits its viewport. |
| Multiple compositions | Partial | Story Sets hold up to 100 outputs, shown one at a time beside a filmstrip. |
| Text | Implemented | Google Fonts, roles, gradient fill, wrap and shrink; one style per layer; no on-canvas editing. |
| Shapes and annotations | Partial | Arrows, curved arrows, rectangles, ellipses, lines. Shapes draw above text, so a filled shape cannot sit under words. |
| Layer selection | Partial | One layer at a time; no multi-select, marquee, grouping, rename or layer copy and paste. |
| Alignment | Partial | Snapping and guides inside one design; no align or distribute. |
| Device and browser frames | Implemented | Devices, browsers, windows, terminals and code screens, up to six screens. |
| Templates and presets | Implemented, hard to discover | Editor templates, layouts, presets and Story Set treatments in four places. |
| Brand kits | Implemented | Override-preserving application per design. |
| Reusable components | Partial | Story Set reusable blocks only; no general component model. |
| Screenshot capture and import | Implemented | Paste, drop, upload, URL capture. |
| Motion | Implemented | Timeline, keyframes, presets, video export. |
| History and autosave | Implemented | Editor undo with gesture grouping; cloud projects and Story Sets autosave with revisions. |
| Collaboration | Partial | Story Sets: presence and field-level merges over revision checks. |
| AI-assisted creation | Implemented | Copilot, variants, copy proposals; the launch pipeline generates campaign designs. |
| Export | Implemented | Still, PDF, video, multi-size ZIP; strict checks for fonts, images and overflow. |
| Campaign integration | Partial | Designs open in the editor by `?design=`, with no way to save back; Story Sets hand deliveries to campaigns. |
| Workflow integration | Partial | Release automation creates campaigns and posts, no visuals. |

Defects found and fixed while building on these systems:

- **Text-only documents rendered at twice their size.** A document whose only
  content arrives in the layout phase has no stage to measure. Loading
  (`lib/design/open-design.ts`) and off-screen rendering
  (`components/design/StageRenderer.tsx`) waited 10 seconds for one, then laid
  pixel layers out against 1920 px while the stage drew at its 960 px
  reference. `layoutCanvasSize` in `lib/design/apply.ts` lays such documents out
  at the size the stage will mount at. The first preview of a text-only
  artboard went from about 10.8 s to under 1 s.
- **Multi-size adaptation overflowed wrapped headlines.** Adapting a wide
  side-by-side layout to a square scaled the type by the shorter side but kept
  the text box as a fraction of the width, so a single long word could not fit.
  `adaptDocumentToSize` now keeps the longest word inside its box.
- **A foreign document write answered with a validation error.** Updating
  another workspace's creative set ran asset validation first and returned
  400; it now returns not found before reading the document.

## Architecture

### Documents

`lib/canvas/document.ts` defines `canvasDocumentSchema` version 1: up to 200
artboards, a workspace product context and delivery records. An artboard has a
stable id, a name, `x` and `y` in workspace units, its native document, an
optional origin pin, optional product context and the provenance of generated
copy. One workspace unit is one exported pixel, so the artboard's size on the
plane is its export size, read from its native document. Moving an artboard
never changes what it exports.

Origins are `project`, `story-set`, `design` (a campaign design, often generated
by the launch pipeline) or `recipe`. Copies carry the source id, revision when
the source has one, the copy time and a SHA-256 of the copied document.

### Persistence

The request path is UI → tRPC `canvas` router → `lib/tenant/canvases.ts` →
backend SDK → Go. The Go service validates every artboard's native document,
requires every `asset:` reference to belong to the workspace, scopes every read
and write to the workspace, and refuses to change a row's kind. Canvas
creation needs the paid workspace; Story Set creation keeps its rollout
feature. The migration adds an immutable `kind` column to the existing table
and an index for listing by kind.

In the browser, `CanvasSession` (`lib/canvas/session.ts`) extends the
`RevisionedSession` extracted from the Story Set session in
`lib/creative-sets/revisioned-session.ts`: typed commands, a 100-step history,
serialized autosave, compare-and-swap retries that merge independent fields
and stop on overlapping ones, a per-tab IndexedDB recovery draft, conflict
handling with load-saved or keep-a-copy, and polling that picks up other
editors' saves. Local images upload to workspace assets before a document is
stored.

### Editing

Every change is a typed command in `lib/canvas/commands.ts`, applied by
`applyCanvasCommand` as one undo step. Commands carry their new ids and
positions, so they are deterministic and tested without a browser. A drag, a
resize or an alignment is one command when the pointer is released.

One artboard at a time is open in the native editor. `useNativeArtboard`
loads it through the generalized `NativeDocumentBridge`, pauses the editor's
own history, and records each gesture as one canvas command. The editor
reloads only when that artboard's document changed outside it, so moving
other artboards never resets the open one. Switching artboards commits the
open one first.

The live stage sits over its artboard at the artboard's on-screen size. While a
zoom gesture runs it is only scaled; it is laid out again when the camera
rests. Pixel layers keep the stage's reference coordinates, so zooming never
rewrites a document.

### Board

`lib/canvas/viewport.ts` holds the camera mathematics and
`lib/canvas/layout.ts` alignment, distribution, tidying, snapping, hit testing
and reading order. The board draws inactive artboards as cached renders from
the editor's own renderer at width buckets that suit the zoom, renders only
artboards near the view, cancels obsolete renders and keeps the previous image
up while a new one draws. Previews are also kept in IndexedDB by document
content and width (`lib/canvas/preview-store.ts`), so reopening a canvas
shows them at once. Session state (selection, open artboard, tool, grid,
camera) lives in `lib/canvas/ui-store.ts` and is never saved or undone; the
camera is remembered per canvas on the device.

### Starting points

`lib/canvas/recipes.ts` builds outcome-first artboards: feature and release
announcements, a five-artboard product launch, walkthroughs, a technical
explainer, before and after, a comparison table and a social pack. Screenshot
layouts reuse the Story Set treatments. `lib/canvas/blocks.ts` adds native
layers to the open artboard: text roles, cards, steps, callouts, workflow
diagrams, comparison tables, statistics, calls to action and shapes; terminals,
code, API responses, browser and device frames go through the editor's frame
commands. Filled containers are image layers drawn behind text, because the
stage draws shapes above it.

### Grounding

Words a recipe quotes from a release record are `verified` and carry the
record. Template wording is `suggested` until a person confirms it. Text a
person typed carries nothing. The product panel shows each generated line's
status, whether it was edited since, and what it quotes. Recipes never invent
metrics, availability dates, testimonials or competitor claims: those slots
remain visible placeholders.

### Export and handoff

`lib/canvas/export.ts` renders saved artboards one at a time at their exact
size in strict mode, so a missing image, an unloaded font or overflowing copy
stops that file with a message. Files are PNG, JPEG or WebP at 1×, 2× or 3×,
one file, a ZIP with a manifest, or a PDF with one image page per artboard.
Hidden layers are left out unless requested. Exports pin a named version
first. Saving to the workspace records deliveries; a delivery attaches to a
campaign as a new draft through the Story Set handoff, which now reads
artboards for a canvas. Approved and scheduled content is never rewritten.

## Interaction

- Pan with a trackpad, the wheel, the hand tool, Space-drag or the middle button; pinch or ⌘/Ctrl-scroll zooms at the pointer.
- Zoom to fit, to the selection, to 100%, or reset; a zoom menu and keyboard shortcuts list every action.
- Click, Shift-click and marquee select artboards; drag them by their body or name, with snapping to other artboards and the grid.
- Resize with handles (Shift keeps the ratio); the composition is laid out again for the new size.
- Align, distribute and tidy; duplicate, copy and paste artboards; create other formats from a selection.
- Double-click or Enter opens an artboard in the editor; Escape or a click outside closes it.
- A context menu, a minimap, a grid with sizes and snapping, and an artboard list.
- Under 768 px the board stays viewable and navigable; artboards, properties and export open as sheets, and layer editing is left to larger screens.

## Performance

Measured on 2026-10-20 on an Apple M1 Max with 32 GB (macOS 26.5.2), headless
Chromium from Playwright 1.63, against the local Docker stack running
`next dev` on Turbopack, so these are development-build numbers. The board had
20 artboards built from the recipes and blocks: 313 native layers, a 99 KB
document.

| Measure | Result |
| --- | --- |
| Open a canvas until it is interactive | median 0.9–1.5 s |
| Every preview drawn, first visit | median 19 s (about 1 s per artboard) |
| Every preview drawn, later visits | median 0.95 s (previews kept on the device) |
| Pan, frame interval during wheel gestures | median 16.7 ms, p95 16.8 ms |
| Zoom, frame interval during pinch gestures | median 16.7 ms, p95 16.8 ms |
| Pointer events, presentation delay (Event Timing) | at most 24 ms |
| Open an artboard in the editor | median 0.34 s |
| A command until the backend confirms the save | median 1.6 s, including the 1.5 s debounce |
| Export five artboards, strict PNG | 5.8–6.3 s |

The remaining bottleneck is the first render of many previews: renders run one
at a time in a hidden frame that shares the main thread. Previews are kept on
the device by content, so it is paid once per change. Rendering previews off
the main thread, or keeping them server-side, would remove it.

## Integration

- The Story Set editor, the project library and campaign asset cards open their content in Canvas.
- `design.listForCampaign` lists a campaign's designs for the campaign picker.
- App Store screenshots keep their own studio and renderer; Canvas links to it rather than reproducing it.

## Security

Reads and writes are scoped to the workspace in Go; another workspace's canvas
id is not found for reads, writes, versions, renames, duplicates and archives.
Documents may reference only uploaded assets of the workspace, and an artboard
never stores a `blob:` URL. Stored documents hold no executable markup: blocks
are native layers, filled containers are PNG data that becomes a workspace
asset on save, and SVG is not accepted as an image source. Canvas pages block
automatic analytics capture and session replay; analytics events carry counts
and command names only.

## Observability

The headline metric is the share of opened canvases that produce an export or
a campaign handoff within the same session. Supporting events are `canvas_open`,
`canvas_command` and `canvas_save_failed` with a reason.

## Verification

Measured results and the commands that produced them are in the delivery
report for this change. The checks are:

- Unit: `test/canvas-model.test.ts`, `test/canvas-content.test.ts`,
  `test/canvas-session.test.ts`, `test/export-adapt.test.ts`, and the existing
  Story Set suites after the session refactor.
- Go: canvas validation, kind isolation, update ownership and canvas handoff in
  `services/internal/product/canvas_test.go`, with the existing creative set
  tests.
- Browser: `test/e2e/canvas.spec.ts` covers a manual announcement, a
  multi-artboard campaign with ZIP export, a generated campaign design refined
  and handed back without changing its approval, interrupted-save recovery and
  conflict handling, and workspace isolation.

## Limits

[RFC 044](./044-canvas-layers-and-automation.md) removes the limits this
version shipped with: several layers of an artboard select, group and move
together and text is typed on the stage; rectangles have rounded corners and
components carry per-layer overrides; members see each other's artboards;
store screenshot groups sit on a canvas; release automation lays out canvases
on the server; and PDF pages can keep real text and vector shapes. Its own
limits are listed there.
