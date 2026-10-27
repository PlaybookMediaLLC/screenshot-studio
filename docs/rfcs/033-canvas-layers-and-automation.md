# RFC 033: Canvas layers, components, presence, store groups, automation and vector PDF

**Priority:** 033 — Reusable foundations
**Previous ID:** 044 ([renumbering map](renumbering-2026-10-24.md))
> **Roadmap disposition (2026-10-23):** Reuse existing canvas capabilities. Further layer, component, store and automation expansion is deferred.
> See the [current execution order](README.md). Older decision text is
> historical wherever it conflicts with that order or the audited architecture.

**Status:** Implemented locally; unit, Go and end-to-end checks pass on a local stack; not deployed

**Date:** 2026-10-20

**Owners:** Product Engineering

**Historical dependencies:** RFC 031, RFC 032

## Decision

RFC 032 shipped Canvas with six limits. This change removes them without a
new scene graph or renderer:

1. Several layers of the open artboard can be selected, grouped and moved
   together, and text is typed on the stage.
2. Rectangles have rounded corners, and components with per-layer overrides
   reuse layers across artboards.
3. Members see who else is on a canvas and which artboard each is editing.
4. App Store and Google Play screenshot groups sit on a canvas, drawn and
   exported by the store renderer.
5. Release automation lays out a canvas from a release on the server.
6. PDF export can keep real text and vector shapes instead of one image per
   page.

Every layer stays a native layer of an artboard's `DesignDocument`, every
store slide stays a native store document, and every file comes from the same
renderers as before.

## Architecture

### Layers, groups and typing on the stage

`lib/canvas/layers.ts` addresses layers across the native document's
sections (text, image overlays, annotations, elements and device mockups) and
moves, duplicates, hides, removes and groups them in canvas fractions, so a
move means the same thing at any artboard size. Groups are stored on the
artboard (`groups`) by layer reference; deleting a layer prunes its group and
a group left with one layer dissolves.

A layer selection overlay sits over the mounted editor and claims only the
gestures the editor does not have: Shift-click and Shift-drag select several
layers, pressing a group or a multi-selection drags it, a double-click enters
a group or types into text, and the text tool places new text where you click.
Every change is one `set-artboard-layers` command. Changes made outside the
editor now load into the open artboard in place through `NativeDocumentBridge.replace`
instead of reopening it, which also removes the flash on undo and redo.

Typed text edits the editor's own text layer in its font and size; emptying it
deletes the layer.

### Corner radius and components

Rectangle annotations take `radius`, a fraction of the shorter side, drawn by
the stage and kept by exports. The Canvas shape blocks add a rounded rectangle.

`lib/canvas/components.ts` keeps a component's main layers with the artboard
size and pixel frame they were made in. An instance places that frame at a
pixel offset in any artboard; its layers are ordinary native layers whose ids
join the instance and main layer ids, so previews and exports need nothing
new. After each native edit `reconcileInstance` records what differs from the
main component as overrides of that layer; moving every layer together moves
the instance. Updating the main component (`componentFromInstance`) redraws
every instance, keeping each one's overrides; reset drops them; detach leaves
plain layers. Component images upload with the canvas like artboard images.

### Live presence

Canvases join the creative set presence rooms Story Sets use, through
`usePresence` in `lib/creative-sets/presence.ts`, which both now share. A
member shares the artboard they have open, their artboard selection and their
saved revision. The header lists who is here, the board rings the artboards
others are editing or have selected, and a newer revision from someone else is
fetched at once. `createCanvasCollabToken` issues a token only for a canvas
of the workspace. The collab server re-authorizes every message, so presence
carries no pointer stream and no content.

### App Store screenshot groups

`lib/canvas/store-groups.ts` places Story Set store groups on the plane: the
native store document, its workspace asset map and a store target id. Slides
sit in a row at the target's pixel size and are drawn by the store renderer.
A group starts new or is copied from a store project in this browser with every
asset uploaded and verified (`migrateStoreProject`), edits in the screenshots
studio's own editor as one canvas command per edit, and exports every store
size and language through the studio's export. Story Sets and canvases share
the upload reconciliation and the storage check (`resolveStoreGroupUploads`,
`storeGroupStored`).

### Canvas generation from release automation

A `create_canvas` action (workflow language version 2) takes a release or
campaign output and 1–3 canvas templates. The Go worker advertises a `canvas`
capability when it can reach the web, and `automationCreateCanvas` posts a
signed request to the internal web endpoint beside rendered creatives, under
the same key. `createWorkflowCanvas` in `lib/workflows/canvas.ts` builds the
artboards with `releaseCanvas` from `lib/canvas/plan.ts`, the same plan the
browser's "from a release" start uses, quoting only the release record. Solid
fills are stored as workspace assets, release screenshots (or the latest
product capture) are measured from their bytes, and the canvas is saved
through the backend. Its id comes from the run and node, and ids inside it are
seeded from that id, so a retried activity returns the canvas it made. The run
page links to it, and templates can add the step.

### Vector PDF

`printCanvasPdf` in `lib/canvas/print.ts` prints the chosen artboards through
the server renderer. A token-scoped print page places each artboard in a
render frame of its own (each frame has its own editor state), on a CSS named
page at the artboard's size, and the headless browser prints it. Text stays
text with a Unicode map and shapes stay vector paths. Strict checks still
refuse a missing font or image. An artboard with visible redactions prints as
flattened pixels so nothing under the blur reaches the file. Without the
server renderer the export says so; the image PDF remains available. Printing
shares the render limit with design renders.

## Security

- Every read and write still goes through the Go backend scoped to the
  workspace; groups, components and store groups live in the canvas document
  that Go validates, and every `asset:` reference anywhere in it must belong to
  the workspace.
- Saves refuse component layers and store assets that are not in workspace
  storage.
- Presence tokens are issued only for a canvas of the workspace and carry no
  canvas content.
- The internal canvas endpoint accepts only requests signed with the workflow
  key within five minutes, and acts as the workspace's service principal.
- The print page opens only with a five-minute render token for one canvas and
  one workspace, and its browser may load only the app and Google Fonts.

## Observability

The headline metric is the share of canvases that produce an export or a
campaign handoff within the same session, now including vector PDFs and
store-size exports. Supporting signals are `canvas_command` events by command
name (`set-artboard-layers`, `add-component`, `update-component`,
`add-store-group`), workflow runs with a `canvasId` output, and render-limit
refusals on the PDF route.

## Verification

- Unit: `test/canvas-layers.test.ts` (layer moves, groups, the component
  lifecycle with overrides), `test/canvas-plan.test.ts` (release plan,
  seeded repeatability), `test/workflow-contracts.test.ts` (templates with the
  canvas step, shared with Go).
- Go: `TestCreateCanvas` in `server/internal/releaseautomation/graph_test.go`
  and `TestAutomationCreateCanvasLaysOutTheRelease` in the product package.
- Renderer: `test/design-renderer.server.ts` prints two named pages over CDP.
- Browser: `test/e2e/canvas-advanced.spec.ts` covers layers, groups, typing,
  rounded rectangles and components (F), presence (G), store groups (H), the
  signed automation endpoint (I) and vector PDF (J);
  `test/e2e/release-automation.spec.ts` adds the canvas step to the fixture
  run.

## Limits

- Layer selection covers text, image overlays, annotations, elements and
  device mockups; blur regions and the main image keep single selection.
- Groups do not nest; grouping a group flattens its members into the new one.
- Instances scale with their placement but not per axis; a resized artboard
  records instance layers it moved as overrides.
- Presence shows artboards, not live cursors.
- Store groups export through the studio's export and are not part of the
  canvas ZIP or PDF.
- Variable web fonts print as Type 3 fonts; their text is selectable, though
  some viewers split words at glyph runs. Vector PDF needs the server renderer.
