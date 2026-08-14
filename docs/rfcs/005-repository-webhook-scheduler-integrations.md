# RFC 005: Repository, Webhook, and Scheduling Provider Integrations

**Status:** Proposed
**Date:** 2026-08-13
**Depends on:** RFC 001, RFC 002, RFC 003, and RFC 004
**Owners:** Product, Engineering, and Security

## Decision

Make Screenshot Studio the release-to-distribution control plane.

Customers can:

1. Connect a source repository and turn a published release into a draft release
   brief and Markdown changelog entry.
2. Send changelog entries or release events to Screenshot Studio through a
   signed inbound webhook.
3. Connect an existing scheduling provider such as Buffer, Post Bridge, or
   Postiz, select its existing social accounts, and schedule approved content
   from Screenshot Studio to that provider.
4. Subscribe their own systems to signed outbound webhooks for release,
   approval, scheduling, and delivery events.

Screenshot Studio owns the release, source Markdown, asset lineage, approval,
desired schedule, and audit record. The scheduling provider owns its connected
social account and the final network delivery. We mirror provider state; we do
not pretend that a successful API request is a published post.

Use explicit provider connectors behind one small capability contract. Do not
build a generic plug-in marketplace, direct integrations for every social
network, or a contact-management product in the first release.

## Problem

Founders already use repositories and scheduling tools. Asking them to retype a
release note into another product and reconnect every social account is not a
useful workflow.

The product must turn a verified source change into one approved, reusable
communication record, then hand approved channel variants to the scheduler the
customer already trusts.

```text
GitHub release or signed changelog event
  -> Screenshot Studio release draft + Markdown source
  -> real product capture and channel variants
  -> approval
  -> Buffer / Post Bridge / Postiz / future provider
  -> remote scheduling and status reconciliation
  -> Screenshot Studio history + customer outbound webhook
```

## Goals

- Ingest a repository release or signed changelog event exactly once.
- Preserve the source release, Markdown revision, assets, decisions, and
  provider receipts as a single lineage.
- Let one organization connect several scheduler accounts and choose precise
  social destinations.
- Support provider drafts, provider-native approval, automatic queueing, and
  exact scheduling only when the provider reports that capability.
- Make scheduled changes, cancellation, failure, and publication visible in
  Screenshot Studio and deliverable to the customer's systems.
- Add another scheduling provider without changing release, approval, or
  tenant data rules.

## Non-goals

- Claim that every scheduler or social network is supported on day one.
- Store customer subscriber lists, social-network passwords, API keys, OAuth
  tokens, or repository secrets in application rows.
- Automatically publish an unreviewed GitHub release body or AI-generated copy.
- Replace Buffer, Post Bridge, Postiz, or a provider's content calendar.
- Build a two-way content editor that silently overwrites provider-side edits.
- Use arbitrary customer-supplied URLs as webhook, Postiz, or media endpoints.

## Product model

### Source, control, and execution records

| Record | Authoritative system | Rule |
| --- | --- | --- |
| Repository release or changelog event | GitHub or customer source | Immutable source evidence |
| Screenshot Studio release | Screenshot Studio | The release brief, source Markdown, assets, approvals, and desired schedule |
| Provider connection and destination | Scheduler provider | Mirror selected workspace and social account metadata |
| Scheduled distribution | Screenshot Studio until handoff | Contains the approved content revision and desired time |
| Remote post | Scheduler provider | Contains actual provider status, final network link, and provider error |
| Delivery history | Screenshot Studio | Immutable attempts, reconciliation result, and audit trail |

A user starts from either a source event or a manual release. Source events
create a **draft**. They never schedule or publish automatically. A person
reviews the product claim, selects assets, creates channel variants, and
approves the output before the provider handoff.

### State model

```text
SOURCE_RECEIVED -> DRAFT -> REVIEW_REQUIRED -> APPROVED
  -> HANDOFF_QUEUED -> ACCEPTED_BY_PROVIDER -> SCHEDULED
  -> PUBLISHED | PROVIDER_APPROVAL_REQUIRED | FAILED | UNKNOWN | CANCELLED
```

- `ACCEPTED_BY_PROVIDER` means the scheduler accepted the request, not that a
  social network published it.
- `PROVIDER_APPROVAL_REQUIRED` means the provider has its own review gate.
- `UNKNOWN` means the request outcome is ambiguous. Reconcile before retry.
- A remote edit becomes `EXTERNALLY_MODIFIED` metadata. It does not overwrite
  the approved Screenshot Studio content revision.

## Connection experience

1. An organization owner or admin chooses **Connect scheduler**.
2. They select Buffer, Post Bridge, Postiz, or a later verified connector.
3. The connector performs the provider's supported authorization flow: OAuth
   where available, or a server-side validated API key when that is the
   provider's model. The browser never receives the stored credential.
4. Screenshot Studio lists accessible workspaces, social accounts, and
   destination capabilities. The user selects only the destinations that this
   organization may use.
5. Screenshot Studio verifies one read capability, records a connection audit
   event, and marks the connection active.
6. A publisher chooses the destination on an approved release variant, selects
   an exact time or provider queue mode, and confirms the handoff.

A disconnected, expired, or revoked connection cannot create new schedules.
Queued jobs re-check connection state before media upload or provider call.

## Initial connector set

| Connector | Verified integration facts | First support |
| --- | --- | --- |
| Buffer | GraphQL API can list connected channels and create, queue, schedule, retrieve, and delete posts. Posts expose states such as draft, scheduled, sent, and error. | Connect workspace, choose channel, create a provider draft or exact scheduled post, reconcile status. |
| Post Bridge | Bearer API key; media requires an upload step, then a post can target several social accounts with `scheduled_at`. The current API has a 10 request/second key limit and no batch create endpoint. | Connect key, select social accounts, upload media, schedule one approved post, throttle and reconcile. |
| Postiz | Public API supports API-key and OAuth access, cloud and customer self-hosted base URLs, and scheduled posts across its connected integrations. | OAuth where available, cloud first, selected integrations, schedule or draft, reconcile. |
| GitHub | GitHub release webhooks include a release event and delivery ID. Signed deliveries can use `X-Hub-Signature-256`. | GitHub App installation, `release.published` ingestion, release body as Markdown draft. |
| Generic webhook | Customer sends a signed versioned release event. | One HTTPS endpoint per source, HMAC validation, draft release creation. |

Provider capabilities and terms can change. Each connector must be revalidated
against its official documentation and a real test account before becoming
generally available.

## Provider capability contract

Every connector implements these operations. Unsupported operations return an
explicit capability result; they do not use a generic fallback.

```text
validateConnection()
listWorkspaces()
listDestinations()
getCapabilities(destination)
uploadMedia(asset)
createDraft(post)
schedule(post, dueAt | providerQueue)
getPost(remotePostId)
cancelPost(remotePostId)
refreshConnection()
parseProviderEvent(rawEvent)
```

The connection stores a snapshot of capabilities per destination:

```text
supportsDrafts
supportsExactSchedule
supportsQueueSchedule
supportsCancel
supportsStatusRead
supportsWebhook
mediaKinds
maxMediaCount
captionLimit
threadSupport
providerApproval
rateLimitPolicy
```

The compose UI validates the destination capability before approval. For
example, it cannot schedule a video, carousel, thread, or custom platform
setting where the selected provider destination does not support it.

Use a separate connector module and contract tests for each provider. Share
only the canonical input, result, error, and capability shapes. Do not create
a run-time plug-in system until more than three production connectors require
it.

## Repository and inbound changelog ingestion

### GitHub App

Install a GitHub App with the smallest required repository permission. Subscribe
initially to the `release` event only. When GitHub sends `release.published`:

1. Verify the raw body with `X-Hub-Signature-256` in constant time before JSON
   parsing.
2. Deduplicate on GitHub `X-GitHub-Delivery`.
3. Store the source release tag, URL, publication time, repository ID, author,
   and raw release body.
4. Create a draft Screenshot Studio release and versioned Markdown document.
5. Audit `release.source_received` and notify the configured creator.

A GitHub release body is untrusted content. Render it as sanitized Markdown and
do not expose it publicly until an authorized user approves it. Repository
access can be removed at any time; removal stops new ingestion but does not
delete an already approved release record without an explicit retention action.

### Generic inbound webhook

Each `ReleaseSource` gets a dedicated HTTPS endpoint and secret reference.
The customer sends an event in this minimum shape:

```json
{
  "id": "external-event-id",
  "type": "release.published",
  "occurredAt": "2026-08-13T15:04:05Z",
  "release": {
    "version": "v1.8.0",
    "title": "Saved brand kits",
    "url": "https://example.com/changelog/v1.8.0",
    "markdown": "## What's new\n..."
  }
}
```

The request includes `X-Screenshot-Source-Timestamp` and an HMAC-SHA-256
signature over timestamp plus raw body. Reject missing, expired, invalid, or
replayed signatures. Deduplicate `id` per source for at least 30 days.

The first generic source supports a published release only. Do not accept
arbitrary HTML, files, credentials, or a request that directly names a social
destination.

## Outbound Screenshot Studio webhooks

Customers can subscribe their systems to release and distribution events:

```text
release.source_received
release.approved
release.document.approved
distribution.scheduled
distribution.accepted
distribution.provider_approval_required
distribution.published
distribution.failed
distribution.cancelled
connection.revoked
```

Every delivery uses a versioned JSON envelope and signed headers:

```text
X-Screenshot-Studio-Event: distribution.published
X-Screenshot-Studio-Delivery: evt_...
X-Screenshot-Studio-Timestamp: 2026-08-13T15:04:05Z
X-Screenshot-Studio-Signature: v1=<HMAC-SHA-256>
```

The signature covers timestamp and the exact raw body. Receivers must reject an
old timestamp, verify the signature in constant time, and deduplicate delivery
IDs. A response in the 2xx range acknowledges delivery. Trigger.dev retries
non-2xx and network failures with bounded exponential backoff. After the retry
budget, mark the delivery failed, alert the organization, and retain it for
manual replay.

Webhook URLs must be HTTPS and pass SSRF checks: no loopback, private,
link-local, or cloud-metadata IP address; resolve again after redirects; no
credentials in URL authority. Deliveries use a short timeout and no redirect
following by default.

## Data additions

Add these organization-scoped records before implementation:

| Record | Required fields | Notes |
| --- | --- | --- |
| `RepositoryConnection` | `provider`, `repositoryExternalId`, `installationReference`, `status` | GitHub App installation reference, never an installation token. |
| `ReleaseSource` | `type`, `repositoryConnectionId` nullable, `secretReference`, `status` | A GitHub source or generic signed endpoint. |
| `InboundEvent` | `releaseSourceId`, `externalEventId`, `eventType`, `payloadHash`, `receivedAt`, `processedAt` | Unique `(releaseSourceId, externalEventId)`. Store redacted normalized payload only. |
| `ProviderConnection` | `provider`, `authType`, `secretReference`, `baseUrl` nullable, `status`, `lastVerifiedAt` | `baseUrl` is allowed only for validated public Postiz endpoints. |
| `ProviderDestination` | `providerConnectionId`, `externalId`, `workspaceExternalId`, `service`, `displayName`, `capabilities`, `status` | Selected remote social account or channel. |
| `Distribution` | `releaseId`, `variantId`, `providerDestinationId`, `contentRevision`, `desiredAt`, `mode`, `status`, `idempotencyKey`, `remotePostId` | One channel-specific handoff. |
| `DistributionAttempt` | `distributionId`, `attemptNumber`, `outcome`, `remotePostId`, `failureCode`, `startedAt`, `completedAt` | Immutable provider handoff history. |
| `WebhookSubscription` | `url`, `secretReference`, `eventTypes`, `status`, `lastSuccessAt` | Organization-owned outbound target. |
| `WebhookDelivery` | `subscriptionId`, `eventId`, `payloadVersion`, `attemptNumber`, `status`, `responseCode`, `nextAttemptAt` | Immutable attempt history; no secret payload data. |

Existing `ScheduledPost` becomes `Distribution` or gains a
`providerDestinationId`; choose one name during the RFC 002 migration review.
Do not maintain two overlapping schedule tables in the final schema.

Every record has `organizationId`, is filtered by organization on every read
and write, and creates an audit event for creation, authorization, state
change, secret rotation, and delivery result.

## Scheduling, reconciliation, and conflict rules

Screenshot Studio chooses the desired schedule and sends it to the provider.
The provider returns a remote post ID and status. We persist both.

- The user can choose exact time or provider queue mode only when supported.
- All times are stored as UTC and rendered in the user's selected IANA time
  zone. An exact local time must resolve unambiguously before confirmation.
- Cancel from Screenshot Studio: mark cancellation pending, call the provider,
  then store the provider result. Do not claim cancelled until it is confirmed.
- Provider status webhook: validate it, deduplicate it, then update the remote
  status mirror and audit it.
- No provider webhook: Trigger.dev runs bounded reconciliation after handoff,
  near due time, after due time, and for `UNKNOWN` outcomes.
- Provider-side edits: show the remote change. Do not silently update the
  approved Screenshot Studio revision. Let the user accept it as an external
  revision or restore the approved version by creating a new provider update.
- A lost request response is `UNKNOWN`. Query provider status by remote ID or
  provider-specific idempotency marker before making another create request.

## Trigger.dev job design

Add these tasks to RFC 004:

| Task | Queue and first limit | Idempotency | Purpose |
| --- | --- | --- | --- |
| `ingest.release-source` | `ingest`, 10 | `ingest:<source-id>:<external-event-id>` | Normalize and create one draft release. |
| `handoff.distribution` | `provider-handoff`, 8 | `handoff:<distribution-id>:<content-revision>` | Re-check approval and call one provider connector. |
| `reconcile.distribution` | `provider-reconcile`, 8 | `reconcile:<provider>:<remote-post-id>` | Read remote state for an unknown or due distribution. |
| `deliver.outbound-webhook` | `webhook-delivery`, 20 | `webhook:<event-id>:<subscription-id>` | Send one signed event to a customer endpoint. |

Tasks use the transactional outbox defined in RFC 004. Payloads have IDs,
revision IDs, and idempotency keys only. They do not contain OAuth tokens,
API keys, webhook secrets, raw GitHub payloads, or media binaries.

Connector throttles start below known limits:

| Provider | Initial throttle | Reason |
| --- | --- | --- |
| Buffer | 2 requests/second per connection | Conservative until production limits are verified. |
| Post Bridge | 8 requests/second per key | Below the documented 10 requests/second limit; upload and post calls share it. |
| Postiz | 1 create request per 45 seconds per connection; batch where supported | Below the documented cloud create-post budget. |
| Outbound webhook | 1 active delivery per subscription | Preserves endpoint order and limits self-inflicted load. |

Run provider status reconciliation on a separate queue so it cannot delay new
schedules. Do not poll published posts forever. Retain the first provider
receipt, then use a low-frequency metrics sync only when the customer has
enabled analytics.

## Security, privacy, and permissions

- Only owner and admin roles can connect or remove providers, repositories, or
  webhook subscriptions. Publisher can use a selected destination but cannot
  expose or rotate its credential.
- Store secrets in the approved secret manager. Database rows contain only a
  secret reference and key version.
- OAuth uses state, PKCE where supported, exact redirect URIs, and a short
  authorization transaction. API keys are entered on a server-side form and
  redacted immediately after validation.
- Provider and repository callbacks verify signature before parsing body.
  External webhooks use HMAC-SHA-256 with timestamp replay protection.
- A customer-hosted Postiz base URL must pass the same outbound SSRF policy as
  a webhook endpoint. Private network access requires a separate enterprise
  networking decision.
- Provider errors are redacted for customers. Operational logs contain IDs and
  request correlation only, never secrets or full external payloads.
- Remove access quickly: revoke or delete the secret, mark connection revoked,
  cancel pending handoffs, and audit the action.
- A support grant cannot view or export provider credentials, raw webhook
  secrets, or unredacted source payloads.

## Rollout

1. Add canonical connection, destination, distribution, and webhook records to
   the RFC 002 schema migration. Add organization isolation tests first.
2. Ship generic outbound webhooks and signed inbound release events with a
   replay test and manual retry UI.
3. Ship GitHub App release ingestion for `release.published` only. Validate
   that a replayed delivery creates one draft.
4. Ship one scheduler connector end to end. Start with Buffer for the common
   scheduler experience, then Post Bridge and Postiz as separate releases.
5. Add provider capability previews, remote status reconciliation, cancellation,
   and external-edit detection before enabling automatic handoff.
6. Add direct social-network connectors only where a customer need cannot be
   met through the supported scheduling providers.
7. Add additional providers only after a named customer request, published API
   verification, contract tests, security review, and support owner.

## Acceptance criteria

- A verified GitHub `release.published` delivery creates one and only one
  draft release and Markdown document.
- A valid generic webhook replay cannot create a duplicate release.
- An invalid signature, expired timestamp, private URL, or cross-organization
  identifier fails without creating a release, task, or provider call.
- An owner can connect a provider, select one destination, see its real
  capabilities, and schedule an approved variant from Screenshot Studio.
- A provider draft, approval-required result, scheduled result, publication,
  cancellation, and failure each map to a visible internal state and audit
  event.
- A task retry or lost provider response cannot create a duplicate remote post.
- Provider-side edits appear as external changes and do not silently overwrite
  the approved Screenshot Studio revision.
- An outbound webhook has a stable delivery ID, timestamped HMAC signature,
  bounded retry history, manual replay, and no secret data in its payload.
- A disconnected provider, expired token, removed GitHub installation, or
  revoked organization membership blocks future handoffs.

## Evidence and review

This RFC records current public integration facts, not an implementation
guarantee. Recheck before each connector release:

- [Buffer API: posts and scheduling](https://developers.buffer.com/guides/posts-and-scheduling.html)
- [Post Bridge API reference](https://api.post-bridge.com/reference)
- [Postiz Public API](https://docs.postiz.com/public-api/introduction)
- [GitHub webhook event payloads](https://docs.github.com/en/webhooks/webhook-events-and-payloads)
- [GitHub webhook signature validation](https://docs.github.com/en/webhooks/using-webhooks/securing-your-webhooks)
