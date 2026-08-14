# RFC 002: PlanetScale Tenant Data Model and Media Lineage

**Status:** Proposed
**Date:** 2026-08-13
**Depends on:** RFC 001 and RFC 003
**Owners:** Engineering

## Decision

Use PlanetScale Postgres as the required production database. Keep Prisma and
the current PostgreSQL data model. This is the smallest safe path: the existing
schema already uses `provider = "postgresql"`, and PlanetScale now provides
managed Postgres with branches, backups, roles, and high-availability options.

Do not migrate this application to PlanetScale Vitess/MySQL unless that engine
is an explicit future requirement. Such a move creates avoidable schema,
migration, and relation changes without improving the release-kit workflow.

Better Auth owns identity, sessions, organizations, membership, and invitations.
Screenshot Studio owns all release, asset, approval, publication, audit, and
support-grant records. Every application-owned product row belongs to one
Better Auth organization.

Trigger.dev is the task executor. PlanetScale is the source of truth for task
intent, result, and audit evidence.

## PlanetScale operating model

- Use one PlanetScale Postgres production cluster in US East, close to the
  primary Fly application region. US West Fly instances write to that primary;
  they do not use a second writable database.
- Use a PlanetScale branch for each isolated application environment. Test a
  reviewed Prisma migration on the development branch, then apply that same
  migration to production through the release procedure. PlanetScale Postgres
  does not provide deploy requests or automatic branch schema merges.
- Create a least-privilege application database role per environment. Do not
  use PlanetScale's default administrative role from the application.
- Use the HA production cluster before selling uptime commitments. PlanetScale's
  single-node option is acceptable only for development or non-critical support.
- Store `DATABASE_URL` only in the deployment secret store. Require TLS
  verification in every production connection string.

PlanetScale's current Postgres offering preserves the PostgreSQL connection
model. Its documentation recommends application-specific roles instead of the
default role. This RFC assumes that engine. If the team chooses the MySQL/Vitess
engine, this RFC must be revised before implementation.

## Current-state constraint

The existing Prisma schema has one `ScreenshotCache` model. Its URL hash is
global and it has no organization ID. The public `/api/screenshot` route uses
it for public URL screenshots.

Do not attach private release-kit captures to this cache. The public route has
a different privacy contract. Start release-kit storage in new tenant tables.
A later cache redesign can be evaluated separately, but a private URL, asset,
cookie, or capture result must never enter the global cache.

## Ownership boundary

| Owner | Tables or objects | Rule |
| --- | --- | --- |
| Better Auth | User, Session, Account, Verification, Organization, Member, Invitation, organization API keys, plugins | Generate from selected plugins; do not hand-edit their behavior |
| Screenshot Studio | Release, assets, approvals, connections, publication, audit, grants | Every business row has `organizationId` |
| PlanetScale | PostgreSQL persistence, branches, roles, backups | Do not store media binaries or raw secrets |
| R2 | Original and generated media | Store a key and integrity metadata, not permanent public URLs |
| Secret manager | Browser and social credentials | Store references and key versions only |
| Trigger.dev | Schedules, retries, durable task execution | Re-read and authorize IDs from PlanetScale before side effects |

## Schema generation and migrations

Better Auth's Prisma adapter supports schema generation but does not support
Prisma schema migration. The safe flow is:

1. Finalize the Better Auth configuration and plugins.
2. Run `npx auth@latest generate` in a branch to generate its Prisma models.
3. Review the generated models and add Screenshot Studio models and relations.
4. Create and test one normal Prisma migration on the PlanetScale branch.
5. Apply the reviewed migration to production through the release procedure,
   record the result, then deploy code that depends on it.

Do not run two migration systems against production. The source for this
constraint is Better Auth's [Prisma adapter
documentation](https://better-auth.com/docs/adapters/prisma).

## Common columns

Every Screenshot Studio tenant table includes:

```text
id              String, primary key, cuid
organizationId  String, required, Better Auth organization ID
createdAt       DateTime, UTC
updatedAt       DateTime, UTC when mutable
```

Use Prisma `Json` only for validated, versioned configuration such as a recipe
or template definition. A JSON document must not contain an access boundary,
status, user ID, or relation that needs database filtering.

## Core application tables

### Brand and source configuration

| Table | Required fields | Rules |
| --- | --- | --- |
| `BrandKit` | `name`, `version`, `definition`, `status` | Definition has validated colors, fonts, logo asset IDs, and copy rules. Published versions are immutable. |
| `SourceApp` | `name`, `allowedHosts`, `status` | `allowedHosts` is the reviewed capture allow-list. |
| `CaptureRecipe` | `sourceAppId`, `name`, `version`, `definition`, `secretReference`, `status` | Definition has steps and viewport, never raw credentials. Active versions are immutable. |
| `CreativeTemplate` | `name`, `version`, `definition`, `status` | Variants store the exact template version used. |

### Release communication

| Table | Required fields | Constraints |
| --- | --- | --- |
| `ReleaseDocument` | `releaseId`, `revision`, `frontMatter`, `bodyMarkdown`, `status`, `approvedByUserId`, `approvedAt` | Unique `(releaseId, revision)`. Approved revisions are immutable. |
| `CustomerCommunication` | `releaseDocumentId`, `channel`, `audienceReference`, `status`, `scheduledFor`, `ctaUrl`, `idempotencyKey`, `triggerRunId` | Stores a provider audience or in-app rule reference, never customer contacts. |
| `CommunicationAttempt` | `customerCommunicationId`, `attemptNumber`, `startedAt`, `completedAt`, `outcome`, `providerMessageId`, `failureCode` | Unique `(customerCommunicationId, attemptNumber)`. Receipt is immutable. |

`ReleaseDocument.frontMatter` contains schema-validated release facts such as
audience, availability, and CTA. `bodyMarkdown` is the canonical human
explanation. HTML is rendered at delivery time and sanitized; it is not a
second editable source. `channel` begins with `changelog`, `in_app`, `email`,
and `social`. `audienceReference` is nullable for a public changelog and is a
provider segment or product-rule ID for other channels.

### Release, capture, and asset records

| Table | Required fields | Constraints |
| --- | --- | --- |
| `Release` | `title`, `benefitStatement`, `status`, `createdByUserId` | The user-visible release work item. |
| `CaptureJob` | `releaseId`, `recipeId`, `recipeVersion`, `status`, `idempotencyKey`, `triggerRunId`, `attempts` | Unique `(organizationId, idempotencyKey)`. Trigger.dev owns retries; this table stores business state. |
| `Capture` | `releaseId`, `recipeId`, `recipeVersion`, `sourceUrl`, `provider`, `status`, `startedAt`, `completedAt`, `failureCode` | Store redacted failure codes only. |
| `Asset` | `captureId` nullable, `parentAssetId` nullable, `objectKey`, `sha256`, `mediaType`, `bytes`, `width`, `height`, `status` | Object key is unique. Any cross-release deduplication needs an explicit privacy review. |
| `CreativeVariant` | `releaseId`, `sourceAssetId`, `brandKitId`, `brandKitVersion`, `templateId`, `templateVersion`, `revision`, `aspectRatio`, `status`, `createdByUserId` | Unique `(releaseId, aspectRatio, revision)`. Do not overwrite approved revisions. |

`Capture` and `CreativeVariant` copy version values as deliberate lineage data.
Deleting or replacing a configuration row must not make an approved asset
unexplainable.

### Review and distribution

| Table | Required fields | Constraints |
| --- | --- | --- |
| `Approval` | `variantId`, `status`, `decidedByUserId`, `decidedAt`, `reason` | A new revision requires a new decision. |
| `ChannelConnection` | `provider`, `externalAccountId`, `secretReference`, `status`, `createdByUserId` | Never stores access or refresh tokens. |
| `ScheduledPost` | `variantId`, `channelConnectionId`, `scheduledFor`, `status`, `caption`, `idempotencyKey`, `triggerRunId` | Unique `(channelConnectionId, idempotencyKey)`. Recheck approval when task starts. |
| `PublicationAttempt` | `scheduledPostId`, `attemptNumber`, `startedAt`, `completedAt`, `outcome`, `providerPostId`, `failureCode` | Unique `(scheduledPostId, attemptNumber)`. Provider receipt is immutable. |

### Reliability, audit, and support

| Table | Required fields | Purpose |
| --- | --- | --- |
| `OutboxEvent` | `organizationId`, `type`, `aggregateType`, `aggregateId`, `payload`, `idempotencyKey`, `deliveredAt` | Atomically records work that a dispatcher sends to Trigger.dev or a SIEM. |
| `AuditLog` | `organizationId`, `actorType`, `actorUserId`, `action`, `entityType`, `entityId`, `requestId`, `outcome`, `metadata` | Append-only business and security evidence. |
| `SupportAccessGrant` | `organizationId`, `requestedByUserId`, `approvedByUserId`, `scope`, `expiresAt`, `revokedAt` | Time-bounded support access. No permanent support membership. |

`OutboxEvent` is retained until confirmed delivery plus its retention period.
`AuditLog` is never updated or deleted by the application role.

## Relationships

```text
Organization
  ├─ BrandKit / SourceApp / CaptureRecipe / CreativeTemplate
  ├─ Release
  │   ├─ CaptureJob -> Capture -> Asset
  │   ├─ CreativeVariant -> Approval
  │   └─ ScheduledPost -> PublicationAttempt
  │   └─ ReleaseDocument -> CustomerCommunication -> CommunicationAttempt
  ├─ ChannelConnection
  ├─ OutboxEvent / AuditLog
  └─ SupportAccessGrant
```

Every child query includes `organizationId`, even when it also filters by a
parent ID. A leaked ID alone cannot authorize access.

## Tenant isolation

1. Resolve session and active organization on the server. Request-body
   `organizationId` is not authority.
2. Confirm Better Auth membership and required role before each action.
3. Add `organizationId` to every select, update, delete, and Trigger.dev task
   re-read. Task payloads contain IDs only.
4. Use R2 paths of `org/<organization-id>/...` and asset-specific signed URLs.
5. Add an adversarial cross-organization ID test to every tenant route and task.
6. Add PostgreSQL row-level security only after all access patterns are tested.
   It is defense in depth, not a substitute for API authorization.

## Indexes and task reliability

- Index tenant lists by `(organizationId, createdAt desc)`.
- Index `Release(organizationId, status, updatedAt desc)` and
  `ScheduledPost(organizationId, status, scheduledFor)`.
- Index `CustomerCommunication(organizationId, status, scheduledFor)` for
  changelog, in-app, and email delivery windows.
- Index `OutboxEvent(deliveredAt, createdAt)` for dispatch and recovery.
- Keep task idempotency keys in both the business record and `OutboxEvent`.
- In one transaction: update business state, append audit row, and append
  outbox event. A failed audit write rejects the sensitive action.
- Trigger.dev retries may run more than once. Each task checks current state
  and the idempotency key before calling Steel or a social provider.

## Retention and deletion

- Delete failed temporary Steel output immediately after copy or job expiry.
- Soft-delete user-visible work first. Cancel unstarted scheduled work, then
  delete R2 media after a configured recovery period.
- Keep audit records and publication receipts for the contract retention
  period. Initial enterprise default: two years, subject to legal requirements.
- Organization deletion revokes sessions and connections, stops tasks, deletes
  tenant media, and keeps only legally required audit evidence.

## Acceptance criteria

- PlanetScale Postgres has least-privilege runtime roles, TLS, an isolated
  development branch, and a reviewed production migration application.
- Generated Better Auth and application schema use one reviewed Prisma
  migration path.
- Every application-owned product table has `organizationId`, an isolation test,
  and a tenant list index.
- Private release-kit flows do not read or write the legacy global cache.
- A completed post links to its source asset, variant revision, approval,
  scheduled post, provider attempt, and audits.
- A customer communication links to one approved Markdown revision, its target
  channel, its delivery attempts, and its audit events without storing a
  customer contact list.
- A Trigger.dev retry cannot duplicate a capture or published post.
- Secrets, cookies, provider tokens, and signed R2 URLs do not enter database
  rows, task payloads, or audit metadata.
