# RFC 006: Release Inputs and Branded Artifact Pipeline

**Status:** Proposed
**Date:** 2026-08-13
**Depends on:** RFC 001, RFC 002, RFC 003, RFC 004, and RFC 005
**Owners:** Product, Engineering, and Security

## Decision

Normalize every founder interaction into one release pipeline:

- A changelog entry from a repository.
- A signed release webhook.
- A manual update written as Markdown.
- A manual upload of screenshots, videos, images, or existing post assets.
- A controlled Steel Browser capture.

The pipeline stores binary inputs and generated media in a **private R2 tenant
artifact bucket**. PlanetScale Postgres stores metadata, content, permissions,
lineage, job status, and R2 object keys. Trigger.dev creates artifact drafts in
the background. A person approves the artifacts, then Screenshot Studio hands
approved channel-specific content to a connected scheduler provider under RFC
005.

Do not treat an upload or webhook as permission to publish. Automation creates
a complete, branded draft package; an authorized person schedules it.

## Context

The current application has an R2 helper for public editor assets and a global
public screenshot cache. It uses public URLs and must remain separate from
tenant releases. A founder's product screenshot, changelog, source video, or
generated social asset is tenant-private data and cannot use the global cache
or public asset path.

The current editor can already compose and export visuals. The SaaS opportunity
is to turn source product evidence into repeatable, reviewed release
communication:

```text
source signal or manual input
  -> private asset and content intake
  -> release brief + pinned brand kit
  -> background artifact planning and generation
  -> human review
  -> connected scheduling provider
  -> published status, learning, and future reuse
```

## Product boundary

This is a **release communications pipeline**, not a generic AI content farm.

A valid release needs:

1. A source: a changelog, webhook, manual explanation, or captured product
   evidence.
2. A founder-supplied outcome and audience: what changed, who benefits, and
   the next action.
3. A pinned brand kit and template policy.
4. Human approval before any public or customer-facing delivery.

If only a screenshot is uploaded, Screenshot Studio can create visual and copy
drafts, but it must request the missing outcome, audience, availability, and
CTA. It must not invent product claims from pixels alone.

## Interaction model

| Founder interaction | Normalized input | Automatic result | Required confirmation |
| --- | --- | --- | --- |
| GitHub release or changelog | `SourceMaterial` with release Markdown | Draft release and source document | Product claim and audience |
| Signed inbound webhook | `SourceMaterial` with normalized release event | Draft release and source document | Product claim and audience |
| Manual update | Release brief plus Markdown | Release document and artifact plan | Source facts and CTA |
| Screenshot, video, or image upload | `Asset` in R2 plus optional note | Asset analysis and artifact plan | Outcome, rights, audience, CTA |
| Existing social draft | Manual Markdown plus attachments | Channel-specific artifact draft | Destination and schedule |
| Steel capture | Capture asset plus recipe lineage | Visual artifact plan | Release outcome and approval |

All paths attach materials to one `Release`. That gives a founder one history
rather than a separate collection of uploads, social drafts, and release notes.

## Release workspace

The first screen is **New release**, not a blank social composer.

1. Choose **Repository release**, **Webhook release**, or **Manual update**.
2. Attach product screenshots, video, existing post assets, or a Steel recipe.
3. State the benefit, audience, availability, and one CTA.
4. Select a brand kit.
5. Select an artifact pack and click **Generate drafts**.
6. Review drafts and make edits.
7. Approve selected artifacts and schedule them through a connected provider.

The default artifact pack contains only useful, distinct outputs:

| Artifact | Purpose | Source |
| --- | --- | --- |
| Release Markdown | Public changelog and help source | Release brief plus verified source material |
| X draft | One sharp product observation and link | Approved release facts and visual |
| LinkedIn draft | Operating implication and proof | Approved release facts and visual |
| Instagram package | Caption plus image/carousel/reel-ready visual package | Brand template and selected visual assets |
| In-app update | Short activation message and feature deep link | Availability and CTA |
| Customer email draft | Change, benefit, limit, and one action | Approved Markdown source |

The user can remove outputs before generation. A platform-specific artifact is
not a resize or transcript of another artifact: it has its own opening, length,
CTA, and supported media requirements.

## Private R2 artifact storage

### Bucket separation

Use a dedicated private bucket, for example
`screenshot-studio-tenant-artifacts`. Do not store tenant assets in the
existing public static asset bucket or the global screenshot-cache prefix.

R2 keys are immutable, organization-scoped prefixes:

```text
org/<organization-id>/releases/<release-id>/inputs/<asset-id>/<sha256>/original
org/<organization-id>/releases/<release-id>/derived/<artifact-id>/<revision>/<sha256>
org/<organization-id>/releases/<release-id>/temporary/<job-id>/<sha256>
```

R2 has a flat key space; these prefixes are for policy, lifecycle, and
operational grouping, not real directories.

### Upload and processing flow

```text
browser -> authenticated upload request -> Asset row: UPLOAD_PENDING
        -> short-lived R2 presigned PUT URL for one key and content type
        -> browser upload
        -> upload-complete API -> Trigger asset.process task
        -> HEAD + checksum + media decode + metadata extraction
        -> Asset row: READY or REJECTED
```

The browser never gets R2 credentials. A presigned URL grants one temporary
operation on one object and is treated as a bearer token.

For every upload:

- Validate organization access, allowed media type, declared size, and quota
  before signing.
- Sign a specific PUT object key with required content type and a short expiry.
- Verify the final object with a server-side HEAD request and a worker-side
  checksum, byte count, magic-byte type check, and safe image or video decode.
- Strip EXIF location metadata from output artifacts unless the user explicitly
  retains it.
- Generate thumbnails or transcoded derivatives as new assets. Never overwrite
  the original upload.
- Reject corrupt, oversized, unsupported, or unsafe media before it reaches a
  renderer or provider connector.
- Use multipart upload for large videos. Do not proxy large uploads through the
  Next.js web process.

An `Asset` is not ready merely because a browser says upload succeeded. Only the
processing task marks it ready.

### Access and retention

- R2 objects are private. The application issues short-lived asset-specific GET
  URLs only after organization authorization.
- Workers read objects with server credentials. Scheduler connectors stream a
  selected asset to the provider; they do not give a provider a durable R2 URL.
- Public changelog images are copied to a separately approved public-delivery
  object or served through an authenticated application route. A private source
  object is never made public by changing its URL.
- Temporary source copies and failed worker output use a short lifecycle rule.
  Original and approved generated assets follow organization retention policy.
- Deleting a release marks database rows first, cancels jobs and distributions,
  then deletes matching R2 prefixes asynchronously. Audit evidence has its own
  retention policy.

## Postgres records

RFC 006 amends RFC 002 with these organization-scoped records. The final Prisma
migration must consolidate overlapping planned names before implementation.

| Record | Required fields | Purpose |
| --- | --- | --- |
| `SourceMaterial` | `releaseId`, `type`, `externalId` nullable, `sourceUrl` nullable, `documentRevision` nullable, `assetId` nullable, `contentHash`, `status` | One changelog, webhook, manual note, upload, or capture evidence item. |
| `Asset` | Existing fields plus `releaseId`, `sourceMaterialId`, `status`, `originalAssetId` nullable, `retentionClass`, `scanVersion` | R2-backed binary metadata; no binary payload in Postgres. |
| `ArtifactPack` | `releaseId`, `brandKitId`, `brandKitVersion`, `sourceSnapshot`, `requestedKinds`, `status`, `requestedByUserId` | Immutable request to make a chosen set of content drafts. |
| `Artifact` | `artifactPackId`, `kind`, `channel`, `revision`, `bodyMarkdown` nullable, `status`, `generatorSpecVersion`, `createdByType` | One derived changelog, text draft, visual, video, email, or in-app item. |
| `ArtifactAsset` | `artifactId`, `assetId`, `role` | Links an artifact to its visual, thumbnail, source, or downloadable output. |
| `ArtifactAttempt` | `artifactId`, `attemptNumber`, `triggerRunId`, `outcome`, `failureCode`, `startedAt`, `completedAt` | Immutable generation history. |

`SourceMaterial.contentHash` deduplicates a source inside one organization. It
does not deduplicate across organizations. `sourceSnapshot` records the exact
source material IDs, hashes, source document revision, brand kit version,
template version, and generator specification used by a pack.

`Artifact` is the general business output. Existing `CreativeVariant` and
`ReleaseDocument` remain valid implementation starting points, but the final
schema must either map them to `Artifact` or remove duplication. Do not keep
three independent models for the same generated item.

## Artifact generation

### Background task graph

```text
ingest source / complete upload
  -> normalize.release-source
  -> process.asset
  -> plan.artifact-pack
  -> draft.content-artifact + render.visual-artifact
  -> validate.artifact
  -> REVIEW_REQUIRED
  -> approved handoff to scheduler provider
```

| Task | Queue | Initial limit | Input | Output |
| --- | --- | ---: | --- | --- |
| `normalize.release-source` | `ingest` | 10 | Source material ID | Draft release facts and sanitized Markdown |
| `process.asset` | `asset-process` | 4 | Asset ID | READY asset metadata and derivatives |
| `plan.artifact-pack` | `artifact-plan` | 4 | Pack ID | One artifact record per requested kind |
| `draft.content-artifact` | `content-generate` | 4 | Artifact ID | Channel-specific Markdown draft |
| `render.visual-artifact` | `media-render` | 4 | Artifact ID | R2 output asset linked to the artifact |
| `validate.artifact` | `artifact-validate` | 8 | Artifact ID | Review-ready, blocked, or retryable result |

Each task uses an explicit global idempotency key based on the immutable input:

```text
source:<source-material-id>:<content-hash>
asset:<asset-id>:<sha256>:<scan-version>
plan:<artifact-pack-id>:<source-snapshot-hash>
artifact:<artifact-id>:<revision>:<generator-spec-version>
```

A task re-reads organization membership, release state, asset status, brand-kit
version, and artifact status from PlanetScale before it starts costly work.
Trigger.dev handles retry and concurrency, but PlanetScale status claims are
the final duplicate guard.

### Generation policy

Content generation can automate draft creation, not truth creation.

The generator receives a minimal, versioned context packet:

```text
approved release facts
source Markdown revision
selected source asset metadata and private worker references
brand-kit tokens and copy rules
channel capability and content policy
artifact kind and CTA
```

It does not receive credentials, provider tokens, unrelated organization data,
or a customer contact list. If an external model is used, the organization must
have an explicit data-processing setting; raw private media is excluded unless
the customer has opted in and the provider contract is approved.

Every generated artifact shows:

- Source materials and release document revision.
- Brand-kit and template version.
- Generator specification and model version, if applicable.
- Warnings for unsupported claims, missing availability, unsupported media, or
  platform capability conflicts.
- Human author or service actor and the time of generation.

A regeneration creates a new artifact revision. It never mutates an approved
artifact or silently changes a scheduled post.

## Brand-kit enforcement

Artifact generation binds to one published `BrandKit` version. The kit contains
approved colors, logo assets, font choices, layout defaults, tone guidance,
approved names, prohibited terms, accessibility rules, and required legal or
availability language.

The visual renderer applies the kit as a template input. The content generator
uses the kit as a constrained style and vocabulary guide. It may recommend
copy, but it cannot convert an unapproved claim into an approved one.

Before review, `validate.artifact` checks:

- referenced assets are READY and belong to the same organization;
- visual template uses the pinned brand-kit version;
- text has the required CTA and respects destination capability limits;
- links use approved hosts;
- images have useful alt text or a review-required missing-alt-text warning;
- no private source object, token, cookie, or signed URL appears in output;
- the artifact's claim text links to a source release fact or is explicitly
  marked as founder-provided interpretation.

## Review and handoff

Artifact lifecycle:

```text
DRAFT -> GENERATING -> REVIEW_REQUIRED -> APPROVED
      -> BLOCKED | FAILED
APPROVED -> SCHEDULED -> HANDOFF_QUEUED -> ACCEPTED_BY_PROVIDER
```

A founder can edit a generated draft before approval. The edit creates a new
revision with `createdByType = user`. Approval applies to exactly one revision.

Only an approved artifact can become a `Distribution` in RFC 005. The handoff
task checks:

1. The artifact is still approved.
2. The selected provider destination is active.
3. The provider destination supports the artifact's media and schedule mode.
4. The source asset is still available and permitted for provider upload.
5. The release has not been cancelled and the creator still has organization
   access.

The scheduler provider receives the minimum content and uploaded media needed
for one post. Screenshot Studio records its remote post ID, status, and receipt.

## Scale, reliability, and cost controls

- Generate artifact packs asynchronously and show a release-level progress
  summary. Never make the founder browser wait for a media renderer.
- Limit active work per organization: start with one asset-processing job, four
  content jobs, and two media renders per organization. Raise after measuring
  queue age and worker capacity.
- Persist all work intent in PlanetScale and send it through the transactional
  outbox. A web process restart cannot lose a completed upload or requested
  generation.
- Use R2 checksum-addressed immutable outputs to avoid rendering the same
  output twice after a retry.
- Set a plan quota for source media bytes, artifact generations, video seconds,
  and active release packs. Block new generation with a clear quota error
  rather than letting one founder create an unlimited bill.
- Store source and generated asset sizes in Postgres. Attribute R2 storage,
  render compute, and provider media upload cost to the organization.
- Keep text generation and media generation in separate queues. A slow video
  render must not delay a release-note draft or scheduled post.

Service targets:

| Area | Target | Guardrail |
| --- | --- | --- |
| Small direct upload availability | p95 under 1 minute | Do not mark READY before worker verification |
| Source normalization | p95 under 30 seconds | Replayed webhook creates no second draft |
| Text artifact draft | p95 under 60 seconds | No unsupported claim auto-approval |
| Image artifact render | p95 under 2 minutes | Preserve source asset on failure |
| Release-pack completion | p95 under 5 minutes for images | Video is a separately declared longer operation |
| Handoff after approval | p95 under 60 seconds | Provider capability and idempotency check required |

## Security and privacy

- Enforce active organization and role checks before source creation, upload
  signing, artifact view, edit, approval, download, and provider handoff.
- Keep all tenant R2 objects private and prefix them by organization ID.
- Validate type with magic bytes and safe decode; do not trust extension,
  browser MIME type, filename, or webhook fields.
- Apply image and video byte, dimension, duration, frame-rate, and decode
  limits before expensive processing.
- Do not pass private screenshots or release text to external generation
  providers without an organization-level opt-in and approved vendor setting.
- Scan external uploads before release use. Treat scan failure as blocked, not
  clean.
- Strip secrets and private URLs from task logs, artifact Markdown, outbound
  webhooks, and provider error messages.
- Preserve original files only according to retention policy. A user request
  to delete media must cancel pending work and remove derived output.
- Audit source ingestion, upload signing, upload validation, generation,
  artifact edits, approval, provider handoff, and deletion.

## Rollout

1. Add the private R2 bucket, access policy, lifecycle rules, and direct-upload
   signing endpoint. Do not use the existing public R2 helper for this path.
2. Add `SourceMaterial`, asset lifecycle states, `ArtifactPack`, `Artifact`,
   and immutable output lineage to the RFC 002 schema migration.
3. Ship manual Markdown updates and image uploads first. Validate the upload,
   approval, and R2 deletion paths with design partners.
4. Add GitHub and generic webhook source material from RFC 005.
5. Add `process.asset`, `plan.artifact-pack`, and one image plus one text
   artifact generator. Keep all outputs review-only.
6. Add remaining artifact packs: X, LinkedIn, Instagram, changelog, in-app,
   and email, based on real provider destination capabilities.
7. Enable scheduling only through approved Buffer, Post Bridge, Postiz, or
   later provider connectors from RFC 005.
8. Add video generation only after image pipeline cost, latency, safety, and
   approval quality meet the service targets.

## Acceptance criteria

- A manual update, GitHub release, signed webhook, upload, and Steel capture
  each create one tenant-scoped source material attached to a release.
- A replayed webhook or retrying upload-complete request cannot create a
  duplicate source material, asset, or artifact pack.
- Browser uploads go directly to private R2 through an authorized short-lived
  URL; the browser cannot mark an object READY.
- Each ready asset has verified metadata, a content hash, an R2 object key, and
  an organization ID in PlanetScale. No binary media is stored in Postgres.
- Each generated artifact links to immutable source material, source document
  revision, brand-kit version, template or generator specification, and all
  output assets.
- A brand-kit change cannot change an existing approved or scheduled artifact.
- An artifact with missing source facts, blocked media, private data, or a
  destination capability mismatch cannot be scheduled.
- A Trigger.dev retry cannot create duplicate generated output or provider
  handoff.
- A source or generated asset from organization A is never available to
  organization B, a public R2 URL, an outbound webhook, or an unapproved
  provider upload.
- An approved artifact can schedule to a selected connected provider and
  receives a remote status receipt under RFC 005.

## Evidence and review

- [Cloudflare R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- [Cloudflare R2 upload guidance](https://developers.cloudflare.com/r2/objects/upload-objects/)
- [Cloudflare R2 object lifecycle rules](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)
- [Trigger.dev idempotency](https://trigger.dev/docs/idempotency)
- [Trigger.dev queues and concurrency](https://trigger.dev/docs/queue-concurrency)
