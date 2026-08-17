# RFC 002: PlanetScale Tenant Data Model and Media Lineage

**Status:** Implemented locally; deployment verification pending
**Date:** 2026-08-14
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

## Implementation status

The application now has a local two-organization proof at
`make tenant-isolation`. It creates separate users and organizations, then
asserts that a session or scoped organization API key cannot list another
organization's releases or access its asset by ID. It also verifies that key
revocation takes effect on the next request. The proof runs in Compose and in
the Kind workflow.

This does not accept the RFC yet. Production verification still requires a
PlanetScale Postgres branch with a least-privilege runtime role, Cloudflare R2
credentials, and the deployed-environment isolation matrix. Webhook, worker,
and support-grant flows require their own two-organization proofs as those
entrypoints are completed.

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

| Owner             | Tables or objects                                                                                      | Rule                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| Better Auth       | User, Session, Account, Verification, Organization, Member, Invitation, organization API keys, plugins | Generate from selected plugins; do not hand-edit their behavior |
| Screenshot Studio | Release, assets, approvals, connections, publication, audit, grants                                    | Every business row has `organizationId`                         |
| PlanetScale       | PostgreSQL persistence, branches, roles, backups                                                       | Do not store media binaries or raw secrets                      |
| R2                | Original and generated media                                                                           | Store a key and integrity metadata, not permanent public URLs   |
| Secret manager    | Browser and social credentials                                                                         | Store references and key versions only                          |
| Trigger.dev       | Schedules, retries, durable task execution                                                             | Re-read and authorize IDs from PlanetScale before side effects  |

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

## Tenant context and principals

Every server action, route, RPC procedure, webhook handler, and task builds one
server-owned tenant context before it reads or changes tenant data:

```text
TenantContext
  organizationId  Better Auth organization ID
  principalType   member | api_key | integration | worker | support
  actorUserId     nullable Better Auth user ID
  role            nullable organization role
  requestId       request, webhook, or task correlation ID
```

`organizationId` in a browser form, URL, API body, or task payload is an input
to validate, not an authorization decision. The server derives the effective
organization from the active session, API-key record, stored integration, or
support grant, then verifies it before the procedure continues.

| Principal   | How the organization is resolved                            | Boundary                                                        |
| ----------- | ----------------------------------------------------------- | --------------------------------------------------------------- |
| Member      | Active Better Auth organization and membership              | The member role permits the requested action.                   |
| API key     | The hashed, scoped Better Auth API-key record               | A key is limited to one organization and explicit scopes.       |
| Integration | Stored `ChannelConnection` or source connection             | Verify the provider signature before loading the connection.    |
| Worker      | The business row loaded by `organizationId` and resource ID | Re-read state and authorization before an external side effect. |
| Support     | An unexpired `SupportAccessGrant`                           | Grant scope and expiry cover the exact organization and action. |

Do not copy an organization ID from an invitation, request header, or webhook
payload into this context. A member with no active organization must select one
or complete onboarding. A support agent never gains tenant access through an
implicit staff role.

## Core application tables

### Brand and source configuration

| Table              | Required fields                                                             | Rules                                                                                                     |
| ------------------ | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `BrandKit`         | `name`, `version`, `definition`, `status`                                   | Definition has validated colors, fonts, logo asset IDs, and copy rules. Published versions are immutable. |
| `SourceApp`        | `name`, `allowedHosts`, `status`                                            | `allowedHosts` is the reviewed capture allow-list.                                                        |
| `CaptureRecipe`    | `sourceAppId`, `name`, `version`, `definition`, `secretReference`, `status` | Definition has steps and viewport, never raw credentials. Active versions are immutable.                  |
| `CreativeTemplate` | `name`, `version`, `definition`, `status`                                   | Variants store the exact template version used.                                                           |

### Release communication

| Table                   | Required fields                                                                                                           | Constraints                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `ReleaseDocument`       | `releaseId`, `revision`, `frontMatter`, `bodyMarkdown`, `status`, `approvedByUserId`, `approvedAt`                        | Unique `(releaseId, revision)`. Approved revisions are immutable.             |
| `CustomerCommunication` | `releaseDocumentId`, `channel`, `audienceReference`, `status`, `scheduledFor`, `ctaUrl`, `idempotencyKey`, `triggerRunId` | Stores a provider audience or in-app rule reference, never customer contacts. |
| `CommunicationAttempt`  | `customerCommunicationId`, `attemptNumber`, `startedAt`, `completedAt`, `outcome`, `providerMessageId`, `failureCode`     | Unique `(customerCommunicationId, attemptNumber)`. Receipt is immutable.      |

`ReleaseDocument.frontMatter` contains schema-validated release facts such as
audience, availability, and CTA. `bodyMarkdown` is the canonical human
explanation. HTML is rendered at delivery time and sanitized; it is not a
second editable source. `channel` begins with `changelog`, `in_app`, `email`,
and `social`. `audienceReference` is nullable for a public changelog and is a
provider segment or product-rule ID for other channels.

### Release, capture, and asset records

| Table             | Required fields                                                                                                                                        | Constraints                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `Release`         | `title`, `benefitStatement`, `status`, `createdByUserId`                                                                                               | The user-visible release work item.                                                                    |
| `CaptureJob`      | `releaseId`, `recipeId`, `recipeVersion`, `status`, `idempotencyKey`, `triggerRunId`, `attempts`                                                       | Unique `(organizationId, idempotencyKey)`. Trigger.dev owns retries; this table stores business state. |
| `Capture`         | `releaseId`, `recipeId`, `recipeVersion`, `sourceUrl`, `provider`, `status`, `startedAt`, `completedAt`, `failureCode`                                 | Store redacted failure codes only.                                                                     |
| `Asset`           | `captureId` nullable, `parentAssetId` nullable, `objectKey`, `sha256`, `mediaType`, `bytes`, `width`, `height`, `status`                               | Object key is unique. Any cross-release deduplication needs an explicit privacy review.                |
| `CreativeVariant` | `releaseId`, `sourceAssetId`, `brandKitId`, `brandKitVersion`, `templateId`, `templateVersion`, `revision`, `aspectRatio`, `status`, `createdByUserId` | Unique `(releaseId, aspectRatio, revision)`. Do not overwrite approved revisions.                      |

`Capture` and `CreativeVariant` copy version values as deliberate lineage data.
Deleting or replacing a configuration row must not make an approved asset
unexplainable.

### Review and distribution

| Table                | Required fields                                                                                            | Constraints                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `Approval`           | `variantId`, `status`, `decidedByUserId`, `decidedAt`, `reason`                                            | A new revision requires a new decision.                                            |
| `ChannelConnection`  | `provider`, `externalAccountId`, `secretReference`, `status`, `createdByUserId`                            | Never stores access or refresh tokens.                                             |
| `ScheduledPost`      | `variantId`, `channelConnectionId`, `scheduledFor`, `status`, `caption`, `idempotencyKey`, `triggerRunId`  | Unique `(channelConnectionId, idempotencyKey)`. Recheck approval when task starts. |
| `PublicationAttempt` | `scheduledPostId`, `attemptNumber`, `startedAt`, `completedAt`, `outcome`, `providerPostId`, `failureCode` | Unique `(scheduledPostId, attemptNumber)`. Provider receipt is immutable.          |

### Reliability, audit, and support

| Table                | Required fields                                                                                                      | Purpose                                                                   |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `OutboxEvent`        | `organizationId`, `type`, `aggregateType`, `aggregateId`, `payload`, `idempotencyKey`, `deliveredAt`                 | Atomically records work that a dispatcher sends to Trigger.dev or a SIEM. |
| `AuditLog`           | `organizationId`, `actorType`, `actorUserId`, `action`, `entityType`, `entityId`, `requestId`, `outcome`, `metadata` | Append-only business and security evidence.                               |
| `SupportAccessGrant` | `organizationId`, `requestedByUserId`, `approvedByUserId`, `scope`, `expiresAt`, `revokedAt`                         | Time-bounded support access. No permanent support membership.             |

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

## Authorization and data-access contract

Tenant scoping is part of every data operation, not a check after a lookup.
Load a child record through both its ID and its organization ID. Do not use a
global `findUnique(id)` for a tenant resource and authorize it later: that
creates both an information leak and an easy future bypass.

```text
Allowed:  where: { id: assetId, organizationId: context.organizationId }
Forbidden: where: { id: assetId } then compare organizationId in application code
```

- Tenant lists, detail reads, updates, deletes, raw SQL, and relation loads
  include `organizationId` in the database predicate.
- Mutations begin with an authenticated tenant context. The client never picks
  the organization that a session or API key may act for.
- Use compound uniqueness where a key is tenant-local, such as the existing
  `(organizationId, idempotencyKey)` records. Keep global unique object keys.
- Foreign keys document lineage, but they do not replace the tenant predicate.
  A relation must be loaded through its tenant-scoped parent or its own tenant
  field.
- Central RPC middleware owns session, key, role, request-ID, and tenant
  resolution. Route handlers and tasks call the same authorization service;
  they do not recreate partial checks.
- Database row-level security, if enabled later, must reject a missing tenant
  setting. Application correctness must not rely on RLS being enabled.

RFC 003 defines roles, SSO, SCIM, and audit-log access. This RFC defines the
data boundary that those permissions operate on.

## Object storage and signed URL contract

R2 is private. Postgres stores the object key, checksum, media metadata, and
lineage only. It never stores a permanent public URL or a reusable signed URL.

Use a deterministic, server-built key shape:

```text
org/<organization-id>/<classification>/<asset-id>/<revision>/<safe-filename>
```

`classification` is a controlled value such as `input`, `capture`, `derived`,
or `export`. `assetId` is generated by the service. `safe-filename` is a
sanitized display suffix only; the original filename stays in validated
metadata and has no authority over the object path.

Before issuing a signed upload or download URL, the service verifies the tenant
context, asset ownership, object classification, allowed media type, byte
limit, and requested operation. The signature permits one exact key and one
operation for a short expiry. The renderer and storage adapter verify that the
key prefix matches the tenant context; an object metadata field is not an
access-control mechanism.

The local Supabase Storage service may front MinIO for development. It is an
R2-compatible storage adapter, not the authorization source. Production keeps
the same key and signing contract whether requests go through that adapter or
directly to R2.

## Inbound sources and webhooks

GitHub, GitLab, changelog, and upload ingestion must anchor every event to a
stored tenant-owned connection. A webhook payload cannot select an
organization.

1. Find the stored connection using the endpoint or provider installation ID.
2. Verify the provider signature, timestamp, and replay window before parsing
   release content.
3. Resolve the tenant context from that connection and record a redacted audit
   event.
4. Deduplicate with the organization, source, and provider event ID. If the
   source has no event ID, use a stable content hash and delivery window.
5. Store the parsed release input and append an outbox event in one transaction.

Do not retain raw provider signatures, access tokens, or unneeded webhook
payloads in `AuditLog`. Failure responses must not disclose whether another
tenant has a matching connection.

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

### Task handoff and reauthorization

An outbox event is the only handoff from a committed tenant mutation to a
background task. Its payload contains the event type, organization ID, and
resource ID; it does not carry session cookies, access tokens, signed URLs, or
authorization decisions captured in the past.

When a worker starts, it reloads the organization-scoped business record and
checks the current release state, approval, connection state, entitlement, and
idempotency key. It records an attempt before calling Steel, R2, Trigger.dev,
or a social provider. A revoked connection, cancelled release, expired support
grant, or withdrawn approval stops the work without a provider call.

Workers use the same immutable attempt records as interactive actions. This
makes a retry explainable and prevents a later task from publishing an old,
formerly approved variant.

## Retention and deletion

- Delete failed temporary Steel output immediately after copy or job expiry.
- Soft-delete user-visible work first. Cancel unstarted scheduled work, then
  delete R2 media after a configured recovery period.
- Keep audit records and publication receipts for the contract retention
  period. Initial enterprise default: two years, subject to legal requirements.
- Organization deletion revokes sessions and connections, stops tasks, deletes
  tenant media, and keeps only legally required audit evidence.

## Isolation verification matrix

The following checks are required in local Compose, Kind, and a deployed
environment before a tenant-facing release:

| Area             | Required assertion                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Browser and RPC  | A member of organization A cannot list, read, update, or delete organization B data with guessed IDs, query parameters, or body fields.                            |
| API keys         | An organization A key cannot use organization B resources, even when it has an otherwise valid scope. Revocation takes effect on the next request.                 |
| Object storage   | A signed organization A URL cannot read, overwrite, list, or delete organization B objects. Expired URLs, path traversal, and unsafe filenames fail.               |
| Inbound webhooks | Forged, replayed, or cross-tenant events create no release, asset, task, or audit detail that reveals another tenant.                                              |
| Background tasks | A retried task cannot duplicate a capture or post, and it stops if approval, membership, connection, or tenant status changed after enqueue.                       |
| Support access   | A staff user without an active scoped grant is denied. A grant use and denial both create audit records.                                                           |
| Observability    | API responses, browser bundles, logs, task payloads, and audit metadata contain no database URL, Redis URL, R2 credential, provider token, or reusable signed URL. |

Run the cross-organization checks with two real organizations and separate API
keys. A test that only changes a body `organizationId` without two principals
does not prove session or key isolation.

## Delivery sequence

1. Generate and review Better Auth models and create the first Prisma migration
   with tenant context, organizations, memberships, API keys, `Release`, and
   `Asset`.
2. Put tenant resolution and authorization in shared RPC and route middleware;
   add cross-organization tests before adding new tenant tables.
3. Add private object signing, key validation, and asset lineage. Keep the
   legacy public screenshot cache outside this path.
4. Add the outbox dispatcher and Trigger.dev workers with idempotency and task
   reauthorization.
5. Add inbound integrations, SIEM draining, and optional PostgreSQL RLS after
   the application-level tenant test suite is stable.

Each stage is independently deployable. A failed later stage must not require
changing the identity or storage boundary established by an earlier stage.

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
- Every entrypoint produces a server-owned tenant context, and no client or
  provider payload can choose an organization without a verified principal.
- Tenant data access is scoped in the database query before a resource is
  returned or changed; shared middleware enforces the same rule for RPC, routes,
  API keys, webhooks, workers, and scoped support access.
- R2 object keys, signed URLs, storage adapters, and local MinIO flows enforce
  the same organization boundary as Postgres.
- The isolation verification matrix passes for two organizations in Compose,
  Kind, and the deployment environment.
