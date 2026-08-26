# RFC 011: First-Class Brand Context

**Status:** Partially implemented (`BrandProfile` and `BrandKit` models exist; validation, versioning, and enforcement do not)
**Date:** 2026-08-17
**Revised:** 2026-08-26
**Depends on:** RFC 010
**Owners:** Product and Engineering

## Decision

Split brand context into two persisted objects:

- **Brand Kit** — visual identity. This exists today.
- **Brand Profile** — marketing identity. This is new.

Every generation call must implicitly know the workspace, product, brand, and
audience. The user must not repeat them.

## Context

`BrandKit` ships with versioning: `(organizationId, name, version)` is unique,
`definition` is JSON, and `CreativeVariant` pins `brandKitId` plus
`brandKitVersion`. That is the right shape.

`BrandProfile` ships as a single unversioned row per organization with
`prohibitedTerms`, `preferredStyles`, and `socialHandles` as untyped JSON. The
model exists; the contract does not. Nothing validates the JSON, nothing
enforces prohibited terms, and no generated copy has ever been checked against
it because copy generation does not exist yet.

This RFC defines those contracts before RFC 015 starts generating copy.

## Goals

- Typed, validated brand context that generation can rely on.
- Prohibited language enforced as a hard gate, not a prompt suggestion.
- Accessible brand output by construction, not by review.
- Reproducible creatives: an old variant renders with the kit it was built on.

## Non-goals

- Multiple brand profiles per workspace. One product, one voice, for now.
- Automatic brand extraction from the website. RFC 012 covers extraction.
- A design-system builder or a token editor beyond the kit's fields.
- Per-channel brand variants.

## Data model

```text
BrandProfile                          BrandKit (exists)
├── product description               ├── name
├── audience                          ├── version
├── tone                              ├── definition
├── tagline                           │   ├── logo assets
├── prohibited language               │   ├── colors
├── preferred visual styles           │   ├── typography tokens
├── social handles                    │   ├── spacing and radius
├── CTA conventions                   │   └── default background
└── defaultBrandKitId ────────────────┘
```

The Brand Profile is workspace-scoped. It links to the existing Brand Kit for
visual values.

### Brand kit definition schema

`definition` becomes a strictly validated, versioned Zod schema rather than
free JSON:

```ts
BrandKitDefinition {
  schemaVersion: 1
  logo: {
    primaryAssetId: string
    markAssetId?: string          // square mark for avatars
    onDarkAssetId?: string
    minWidthPx: number            // never render smaller
    clearSpaceRatio: number       // padding as a multiple of logo height
  }
  colors: {
    primary: Hex
    secondary?: Hex
    accent?: Hex
    background: Hex
    surface?: Hex
    text: Hex
    textMuted?: Hex
  }
  typography: {
    headingFamily: FontToken      // from the bundled font registry
    bodyFamily: FontToken
    headingWeight: 400|500|600|700|800
    scale: 'compact' | 'default' | 'generous'
  }
  layout: {
    radius: number                // 0-64
    spacing: 'tight' | 'default' | 'roomy'
    defaultPadding: number        // 0-256
  }
  defaults: {
    background: BackgroundToken
    frame?: FrameToken
    shadow?: ShadowToken
  }
}
```

Fonts are tokens from a server-side registry of bundled fonts, never URLs or
family-name strings. This is both a determinism requirement from RFC 010 and a
security boundary: a brand kit must not be able to make the renderer fetch a
remote resource.

Colors are validated hex. Numeric fields are range-bounded. Asset references
are verified to belong to the organization and to be images.

### Brand profile schema

```ts
BrandProfile {
  productDescription: string        // 20-500 chars
  audience: string                  // 10-300 chars
  tone: ToneToken[]                 // 1-3 from a fixed vocabulary
  tagline?: string                  // ≤ 120 chars
  ctaConventions?: string           // ≤ 200 chars
  prohibitedTerms: ProhibitedTerm[] // ≤ 100 entries
  preferredStyles: StyleToken[]     // from the creative registry
  socialHandles: SocialHandle[]     // ≤ 10, per-platform validated
  defaultBrandKitId?: string
}

ProhibitedTerm {
  term: string                      // 2-64 chars
  matchMode: 'word' | 'substring'
  caseSensitive: boolean
  reason?: string                   // shown to the author on a block
}

SocialHandle {
  platform: 'x' | 'linkedin' | 'instagram' | 'youtube' | 'github'
  handle: string                    // platform-specific pattern
}
```

`tone` is a fixed vocabulary rather than free text so that generation prompts
map tones to concrete instructions and so that two workspaces choosing
"technical" get consistent behavior. Free-text tone is available through
`ctaConventions` and the product description.

## Inheritance and resolution

Resolution order for any generation call, first match wins:

1. An explicit value on the call.
2. The referenced brand kit or profile.
3. The workspace default brand kit.
4. A platform default.

Resolution is a pure function returning a fully-resolved context plus a record
of where each value came from. The resolved record is what gets pinned into a
creative spec, so a variant never depends on a later lookup.

Missing brand context never blocks generation. A workspace with no kit renders
with platform defaults and the UI reports which values were defaulted. Blocking
generation on an incomplete brand kit would break onboarding, which is the
exact moment the kit is least complete.

## Prohibited language

Prohibited terms are a hard filter applied server-side to every piece of
generated copy, at the point of persistence, not in the prompt.

The pipeline:

1. Terms are included in the generation prompt as guidance. This reduces
   violations but is not the enforcement.
2. Generated copy is checked against the compiled term list before it is
   written. `word` mode matches on Unicode word boundaries; `substring` mode
   matches anywhere.
3. A violation blocks persistence and returns the matched terms and reasons.
4. The generator retries once with the violations named explicitly.
5. A second violation persists the copy as `DRAFT` with a visible block flag.
   It cannot reach `READY_FOR_REVIEW` until a human edits it.

The check also runs on manually authored and manually edited copy, so the rule
is a workspace rule rather than an AI rule. It runs again immediately before
scheduling, because the term list may have changed since generation.

Normalization before matching handles the obvious evasions: case folding when
not case-sensitive, Unicode NFKC normalization, and collapsing of repeated
whitespace. This is not adversarial filtering; it defends against a model
producing a banned competitor name, not against a determined human.

## Accessibility

Brand values that produce unreadable output are a defect the platform should
catch, since a founder picking brand colors is not thinking about contrast on a
gradient background.

- Text and background pairs are checked for WCAG AA contrast, 4.5:1 for body
  and 3:1 for large text.
- A failing pair produces a warning at kit save time with a suggested adjusted
  shade. It is a warning, not a block, because a brand may legitimately want a
  low-contrast decorative treatment.
- The renderer automatically selects the light or dark logo variant and the
  light or dark text token based on the measured background luminance behind
  the text, including over gradients and images.
- Minimum logo width and clear space are enforced by the renderer. A layout
  that would violate them scales the layout instead of the logo.

## Versioning

Brand kits are already versioned, and that model extends to profiles:

- Editing a kit creates a new version; existing versions are immutable.
- `CreativeVariant` pins the version, so re-rendering an approved creative a
  year later produces the same output.
- A kit version can be `ARCHIVED`, which prevents new use but never breaks an
  existing pin.
- Brand profiles gain the same treatment. Copy records the profile version used
  so a change in prohibited terms does not retroactively invalidate approved
  content, while the pre-schedule re-check still catches genuinely new
  violations.

Rendering with an archived version is allowed for reproduction and refused for
new creation.

## Authorization

| Operation                | Permission        |
| ------------------------ | ----------------- |
| Read kit or profile      | `workspace:read`  |
| Create or update kit     | `brand:manage`    |
| Create or update profile | `brand:manage`    |
| Archive a kit version    | `brand:manage`    |
| Set the workspace default| `brand:manage`    |

`brand:manage` is held by `owner` and `admin`. Creators read brand context but
do not change it, so a creator cannot widen the prohibited-term list to get a
draft through.

API keys may read brand context and may not modify it. Brand identity is a
human decision.

## Asset processing

Uploaded logos are validated and normalized on ingest:

- Accepted types: PNG, SVG, WebP, JPEG. Maximum 5 MB.
- SVGs are sanitized: scripts, external references, and embedded foreign
  objects are stripped. An SVG that fails sanitization is rejected rather than
  silently altered. An unsanitized SVG in the renderer is remote code
  execution in a headless browser.
- Raster logos are checked for a minimum dimension and reported when too small
  for the largest export scale.
- Derived variants are generated once: a square mark crop, and light and dark
  treatments where a transparent background allows it.
- Dominant colors are extracted and offered as suggestions for an empty palette.

## Failure behavior

| Situation                             | Behavior                                          |
| ------------------------------------- | ------------------------------------------------- |
| Kit references a deleted asset        | Save fails validation; render falls back to no logo |
| Font token not in the registry        | Save fails with the allowed token list            |
| Contrast check fails                  | Warning with a suggestion; save proceeds          |
| Profile missing at generation time    | Platform defaults; the response reports defaults  |
| Prohibited term added after approval  | Pre-schedule re-check blocks; post returns to review |
| Concurrent kit edits                  | Version numbers serialize; both edits are kept    |

## Acceptance criteria

1. A workspace stores a complete Brand Profile, and a creative primitive call
   applies the linked Brand Kit without explicit parameters.
2. A kit definition with an invalid hex color or unknown font token is
   rejected with field-level errors.
3. An SVG logo containing a script tag is rejected.
4. Generated copy containing a prohibited term does not persist as approved
   and reports the matched term and reason.
5. Manually edited copy containing a prohibited term is blocked identically.
6. A prohibited term added after approval blocks scheduling.
7. Editing a kit creates a new version, and an existing variant re-renders
   byte-identically against its pinned version.
8. An archived kit version cannot be selected for a new creative but still
   renders an existing one.
9. A low-contrast color pair produces a warning with a suggested shade.
10. Rendering over a dark background automatically selects the light logo.
11. A workspace with no brand kit still generates a creative using platform
    defaults, and the response names every defaulted value.
12. A `creator` cannot modify the prohibited-term list.

## Rollout

1. Ship the Zod schemas and validate on write. Backfill existing rows,
   reporting rather than deleting anything that fails.
2. Ship resolution and defaulting; wire it into RFC 010's `applyBrandKit`.
3. Ship the prohibited-term filter in report-only mode; measure the hit rate.
4. Promote the filter to enforcing.
5. Ship contrast checks and logo derivation.
6. Ship profile versioning with RFC 015, when copy generation first needs it.

## Out of scope

- Multiple brand profiles per workspace.
- Automatic brand extraction from the website. RFC 012 covers extraction.
