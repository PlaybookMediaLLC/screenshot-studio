# RFC 031: Story Sets

**Priority:** 031 — Reusable foundations
**Previous ID:** 040 ([renumbering map](renumbering-2026-10-24.md))
> **Roadmap disposition (2026-10-23):** Reuse existing native visual compositions. Additional creative breadth is deferred pending paid release-kit evidence.
> See the [current execution order](README.md). Older decision text is
> historical wherever it conflicts with that order or the audited architecture.

**Status:** Expanded implementation; local runtime checks passed; pilot validation pending

**Date:** 2026-10-19

**Owners:** Product Engineering

**Historical dependencies:** RFC 010, RFC 011, RFC 035, RFC 019, RFC 023

## Decision

A Story Set connects product evidence and shared messages to editable native
marketing compositions. The requested implementation includes multiple stories,
store groups, reusable blocks, AI proposals, motion, concurrent editing, and
campaign handoff through the existing approval and automatic publication flow.
Existing projects remain in their original editors. Import creates a lossless
copy with origin ID, revision, date and document hash.

Each new story produces three authored formats: wide 1600 × 900, square
1080 × 1080 and portrait 1080 × 1350. Product Hero, Editorial Split, Detail
Spotlight and Product Close-up provide distinct arrangements for each size. These are defaults, not
destination requirements. Sets support up to 20 stories, 100 main outputs and
20 store groups; existing native store slide and layer limits still apply.

## Native documents and editing scope

CreativeSetDocument v2 reads the earlier single-story v1 envelope. It owns
stable story/output IDs, explicit bindings, version pins, overrides and complete
native documents. The main editor and store studio retain their own schemas,
units and renderers. No universal scene graph or third renderer is introduced.

Story-panel edits propagate to linked roles. Local native edits create explicit
exceptions. Copy resets restore only that link; geometry and styling remain
native and local. Source replacement creates immutable bytes, previews affected
outputs, preserves overrides, and requires crop/focus/redaction review before
delivery. Brand updates are previewed and pinned, using assignment ledgers to
preserve local styles. Store theme fields also have individual reset controls.

One active native canvas is mounted. The set session owns history and saving;
legacy history is paused while embedded. Gestures and shared changes are set
transactions. Switching outputs flushes the active edit. Loading resolved
native documents cannot create phantom edits. Inactive previews use the native
renderers, and main exports do not perform a second size adaptation.

## Persistence, recovery and concurrency

The request path remains UI → tRPC → tenant service → backend SDK → Go/Ent.
PlatformCreativeSet and PlatformCreativeSetVersion save the complete set under
one revision. Updates carry baseRevision; restoration creates a new revision.
Client-generated creation intent IDs reconcile lost responses. Reads require
artifact:read; mutations require artifact:edit with existing API-key scope checks.
Go scopes sets, versions, nested assets and published block/brand pins to the
active workspace. Current documents, retained versions and published reusable
blocks retain their referenced assets, including archived records.

Serialized autosave and separate workspace:set:tab IndexedDB recovery preserve
local work. Main-image bytes are retained in recovery; store bytes remain in
native IndexedDB. Migration uploads and verifies images/fonts by SHA-256 before
cloud saving, retains verified progress during retries, and never deletes the
original local project. Cloud reopen resolves stable native IDs through the
workspace asset mapping.

Concurrent editing uses the existing Hocuspocus service for presence and Go
compare-and-swap revisions for durable documents. Presence carries user, output
and revision, not document bytes. Native fields and stable-ID layers merge when
edits do not overlap. Conflicting fields or delete-versus-edit collisions stop
with load-saved or preserve-copy choices. Undo reverses local fields while
preserving independent peer changes, and refuses overlapping later edits.
Polling reconciles remote revisions and reconnects even without presence.
Current membership is checked on collaboration messages; viewers cannot send
Yjs document changes. This is field-level coediting, not character-level CRDT.

## Reuse, proposals and motion

Published compositions, headline blocks and proof-detail blocks use existing
versioned CreativeTemplate records. Instances retain their pinned assignment,
stable role bindings and local fields. Updating offers Keep/Discard comparison;
field reset and detach preserve native editability. Arbitrary nested components
are outside the supported block model.

AI copy proposals use the existing permitted text processing, credit and policy
flow. They accept supplied facts, explicit story/output scope, and a revision.
Validated Keep applies an ordinary command in one history step; Discard changes
nothing. Screenshots are not sent in this proposal path. Manual authoring works
without AI.

Proof Reveal, Gentle Pan and Clean Entrance add native timeline tracks while
preserving unrelated custom animation. Overlapping custom tracks require an
explicit correction. Native timeline controls remain available. Main and store
motion exports use their existing capture/encoding engines; cancellation and
font/image/source-review failures must prevent a successful delivery result.

## Delivery, campaign handoff and publication

Exact-size native previews produce PNG/ZIP and motion files. Checks block missing
assets, failed fonts, text overflow/clipping and unresolved source reviews.
Before rendering, an exact saved revision is pinned. Each delivered file records
set revision, output ID, native-document hash, source IDs and brand/composition
versions; store files also record slide, locale and target dimensions.

Saving to workspace creates new immutable assets. Campaign handoff atomically
and idempotently attaches selected delivered files as design candidates and
post drafts with source provenance. Existing campaign review, release linkage,
approval, scheduler and publishing worker own automatic publication. A set edit
cannot replace approved or scheduled bytes. No new scheduler or publishing
provider is introduced, and handoff itself does not publish.

## Rollout, rollback and measurement

Apply the additive migration through the existing runner. New-set creation is
off by default. Enable creative-sets:create for paid design-partner workspaces;
PLATFORM_CREATIVE_SETS=enabled is the development-wide override. Disabling
creation also disables duplication while saved sets and legacy editors remain
accessible. No new public REST or MCP product surface is added.

Asset retention currently scans a workspace's sets, versions and reusable
blocks. Measure database cost before increasing volume; introduce a reference
index if scanning becomes material. Browser rendering is serialized and
cancellable. Lazy native panels limit initial loading. Benchmark warm ordinary
input-to-paint p95 against 50 ms and three still exports against 15 seconds on a
named machine; development compilation is not a rendering benchmark.

Private authoring surfaces disable automatic content capture and session replay.
Explicit metrics contain counts, enum actions and timings: creation, shared
updates, overrides, save conflicts, export errors and completion. Screenshot and
copy content must not enter analytics.

## Verification and customer evidence

Extend native document, command, renderer and recovery suites. Cover stable
bindings, local exception reset, exact history, stale and interrupted saves,
two principals, nested asset isolation, lossless native/store imports, reusable
version adoption, proposals, motion and immutable campaign scheduling. Use real
local database/storage/browser infrastructure with publication providers mocked.
Runtime results and remaining failures belong in the delivery report; this RFC
does not claim an unrun check passed or that software has been deployed.

Customer comprehension and repeat use remain unproven. Recruit eight target
users with real launch materials, measure scope prediction and composition
quality, and observe a second task within 30 days. Proposed decision gates are
six completing three formats within 15 minutes, seven predicting scope,
independent reviewers preferring the new composition in two-thirds of comparisons,
and five returning. These small-study thresholds are not statistical proof.
