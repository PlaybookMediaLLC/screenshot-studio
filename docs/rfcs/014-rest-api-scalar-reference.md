# RFC 014: First-Class REST API and Scalar Reference

**Priority:** 014 — Reusable foundations
**Previous ID:** 034 ([renumbering map](renumbering-2026-10-24.md))
> **Roadmap disposition (2026-10-23):** Reusable API foundation. Extend existing contracts and clients for release-readiness operations as they are implemented.
> See the [current execution order](README.md). Older decision text is
> historical wherever it conflicts with that order or the audited architecture.

**Status:** Implemented (phases 1–3 shipped)  
**Status note (2026-10-17):** Campaigns, approvals, and scheduled posts are served under `/api/v1`. Every gated operation publishes `x-shots-entitlement`, a typed client is generated from the document, and CI blocks unintended breaking changes. The questions the owning RFCs leave open are listed under Open questions.  
**Date:** 2026-08-26  
**Revised:** 2026-10-17  
**Owners:** Platform Engineering  
**Historical dependencies:** RFC 010, RFC 009, RFC 035

## Decision

Shots ships a versioned, workspace-aware REST API as a first-class product
surface. The same Next.js application publishes:

- interactive Scalar documentation at `/api-reference`;
- the canonical OpenAPI 3.1 document at `/openapi.json` and `/.well-known/openapi.json`;
- stable JSON endpoints under `/api/v1` for platform operations;
- the editor utility endpoints under `/api` until they can be versioned without breaking users.

The OpenAPI document is the public contract. It is generated from the same
zod contracts the handlers validate with. Scalar renders that contract and
provides request examples and an interactive client. It is never a second,
manually maintained description of the API.

## Context

Route Handlers, standardized JSON errors, and an OpenAPI 3.1 document existed
before this RFC, but there was no interactive reference and tenant endpoints
had no stable version namespace. Phases 1 and 2 below closed both gaps.

Dub's open-source application is prior art for treating the web application
and HTTP API as one product: route handlers live with the Next.js application,
operations have typed schemas, and the contract drives SDK and documentation
workflows. Shots adopts that boundary and uses Scalar for the reference.

Product data lives behind the Go backend. API handlers call it through
`lib/backend/sdk.ts`; they never touch the database.

## Goals

- Give engineers one discoverable, interactive reference for every supported REST operation.
- Make API-key calls and browser-session calls enforce the same workspace authorization rules.
- Keep OpenAPI operation IDs, request schemas, response schemas, examples, and implementation behavior synchronized.
- Preserve request IDs, auditability, idempotency, rate limits, and tenant isolation.
- Support generated clients from the same contract.

## Non-goals

- Replacing tRPC for the first-party browser application.
- Moving or removing `/api/screenshot`, `/api/export`, or the other editor endpoints before versioned replacements exist.
- Exposing internal service routes.
- Publishing database-shaped CRUD endpoints.
- Supporting GraphQL.

## Public surface

| URL                                                                     | Purpose                              | Authentication                                                         |
| ----------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------- |
| `/api-reference`                                                        | Scalar interactive API documentation | Public                                                                 |
| `/openapi.json`                                                         | Canonical OpenAPI 3.1 document       | Public                                                                 |
| `/.well-known/openapi.json`                                             | Well-known alias for discovery       | Public                                                                 |
| `/api/v1/*`                                                             | Versioned platform REST API          | Workspace API key or user session, per operation                       |
| `/api/screenshot`, `/api/export`, `/api/tweet/{id}`, `/api/image-proxy` | Editor utility operations            | Session or API key with `artifact:read`, on a workspace with paid plan |
| `/api/internal/*`                                                       | Service-only operations              | Never included in the public specification                             |

## Resource model

`/api/v1` resources mirror product concepts rather than database tables.

Shipped:

- `releases` (list, create)
- `assets` (signed upload URL, upload completion, signed download URL, delete)
- `source-apps` (create, update)
- `link-preview`
- `campaigns` (list, get, create, status transitions, post scheduling)
- `approvals` (the review queue, review requests, and review decisions)
- `scheduled-posts` (list, create, cancel)
- workspace shell operations: `me`, `bootstrap`, and `organizations` with
  members, invitations, permissions, capabilities, settings, and activation

A resource may be added only when its authorization, lifecycle, idempotency,
and audit behavior are defined in its owning RFC. The next section records
them for the three resources added in phase 3.

## Campaigns, approvals, and scheduled posts

Each operation calls the Go backend through `lib/backend/sdk.ts`, and the
backend scopes every read and write to the authenticated workspace. An
identifier from another workspace selects nothing and returns `404`.

### Authorization

| Operation | Path | API key scope | Session permission | Plan gate | Quota |
| --- | --- | --- | --- | --- | --- |
| `listCampaigns` | `GET /api/v1/campaigns` | `artifact:read` | `artifact:read` | `campaign:workflow` | none |
| `getCampaign` | `GET /api/v1/campaigns/{campaignId}` | `artifact:read` | `artifact:read` | `campaign:workflow` | none |
| `createCampaign` | `POST /api/v1/campaigns` | `release:create` | `release:create` | `campaign:workflow` | `api:write:minute` |
| `transitionCampaign` | `POST /api/v1/campaigns/{campaignId}/transitions` | `release:create` | transition table | `campaign:workflow` | `api:write:minute` |
| `listApprovals` | `GET /api/v1/approvals` | `artifact:read` | `artifact:read` | `campaign:workflow` | none |
| `requestCampaignReview` | `POST /api/v1/campaigns/{campaignId}/review-requests` | `release:create` | `release:create` | `campaign:workflow` | `api:write:minute` |
| `decideCampaignApproval` | `POST /api/v1/campaigns/{campaignId}/approvals` | refused | `release:approve` | `campaign:workflow` | none |
| `scheduleCampaignPost` | `POST /api/v1/campaigns/{campaignId}/posts/{postId}/schedule` | `post:schedule` | `publish:manage` | `campaign:workflow` | `api:write:minute`; monthly posts, in the backend |
| `listScheduledPosts` | `GET /api/v1/scheduled-posts` | `artifact:read` | `publish:manage` | `workspace:use` | none |
| `createScheduledPost` | `POST /api/v1/scheduled-posts` | `post:schedule`, variants only; a content draft needs a session (RFC 013) | `publish:manage`, fresh 2FA | `workspace:use` | `api:write:minute`; monthly posts, in the backend |
| `cancelScheduledPost` | `POST /api/v1/scheduled-posts/{scheduledPostId}/cancel` | `post:schedule` | `publish:manage`, fresh 2FA | `workspace:use` | `api:write:minute` |

The rules come from the owning RFCs:

- RFC 012 makes approve, reject, and request changes a person's decision, so
  `decideCampaignApproval` binds `memberAccess` and refuses an API key with
  `403` before it reads the session. Machine submission is the separate
  `requestCampaignReview` operation, which RFC 012 lists as refinement 7 and
  the backend serves as `posts/submit` with the `release:create` key check.
- The campaign transition table (`campaignStatusTransitions` in
  `lib/tenant/campaign-status.ts`, enforced again in the backend) decides the
  role for each move. Moving a campaign to `APPROVED` refuses an API key.
- RFC 030 makes scheduling a publisher's action and reading the schedule a
  routine read. Creating or cancelling a scheduled post from a session needs
  a fresh second factor. Scheduling a campaign post asks for `publish:manage`,
  as the in-app procedure does.
- RFC 026 adds the `post:schedule` key scope, at the owners' request. It
  schedules and cancels but never approves: every scheduling path accepts
  only an approved post or variant. The backend rechecks the scope itself.
  `artifact:read` reads the schedule.

### Lifecycle

- A created campaign and every post in it start as `DRAFT`. Nothing the API
  creates is reviewed, scheduled, or published by creation alone.
- Posts move `DRAFT` or `NEEDS_CHANGES` to `READY_FOR_REVIEW` by review
  request. They then move to `APPROVED`, `REJECTED`, or `NEEDS_CHANGES` by a
  reviewer's decision (RFC 012). The batch semantics are RFC 012's: omitted
  `postIds` means every eligible post, a listed post that is not eligible
  fails the whole call with `409`, and the batch is one transaction.
- Scheduling moves an `APPROVED` campaign post to `SCHEDULED`. It needs an
  approved visual and a channel connection that publishes the post's channel.
  It also reads the post's links first, unless `skipLinkCheck` is true.
- Scheduled posts move `SCHEDULED` to `PROCESSING` to `PUBLISHED`, or to
  `FAILED`, `CANCELLED`, or `UNKNOWN_DELIVERY` (RFC 030). Cancelling works from
  `DRAFT`, `SCHEDULED`, and `FAILED`, and is a no-op on a cancelled post.

### Idempotency

| Operation | Behavior |
| --- | --- |
| `createCampaign` | Optional `Idempotency-Key`. The backend stores it on the campaign, unique per workspace. A retry returns the first campaign with `200` and `created: false`. A concurrent duplicate loses the unique constraint and returns the winner. |
| `createScheduledPost` | `Idempotency-Key`, unique per channel connection (RFC 030). Without one, the route mints a key per request. A retry returns `200` and `created: false`. |
| Transitions, review requests, decisions | Each applies only from the current status with a conditional write, so a repeated request changes nothing and returns `409`. |
| `cancelScheduledPost` | Repeating it returns the cancelled post unchanged. |
| `scheduleCampaignPost` | The scheduled post is keyed on the campaign post, so repeating the request on the same channel returns the post as scheduled. Another channel returns `409`. After a cancel or failure it schedules a new post. |

### Audit

Every mutation writes its audit record in the same transaction as its effect:

- `product.campaign_created`;
- `product.campaign_status_changed`, with `from` and `to`;
- `product.campaign_post_status_changed`, one record per batch with `decision`
  and `postCount`;
- `post.scheduled` and `post.cancelled`;
- `product.campaign_post_scheduled`, with `campaignId` and `scheduledPostId`.

The actor is the session user or the API key's display name, and the request
ID is the caller's `X-Request-Id`. The review queue and the other reads are
not audited.

### Open questions

The owning RFCs leave these open. The operations above implement only what
those RFCs define.

1. **Approval policies (RFC 043, not built).** There is no policy or
   policy-decision resource. When policies ship:
   - Should `listApprovals` carry each post's policy decision (rule,
     classifications, override reason)?
   - Policy edits and activation are session-only by RFC 043. Do they belong
     under `/api/v1/approval-policies` at all?
2. **Approving changed content (RFC 012 refinement 1).** A reviewer can approve
   a post that changed after they last read it. Should a decision carry the
   version it approves, such as `updatedAt` or a content hash, and fail with
   `409` when the post moved on?
3. **Separation of duties (RFC 012, RFC 043).** Self-approval is allowed. RFC
   012 defers separation of duties to RFC 043 policy, so the API allows it too.
4. **Recurring plans (RFC 041, not built).** There is no resource for the
   recurring plan configuration or its runs.
   - RFC 041 grants "trigger a manual run" to `release:create` but does not say
     whether an API key may trigger one.
   - It does not define the period key on campaigns, or how an expired plan
     reads (archived with a reason, or a separate state).
5. **Reading the schedule with a key.** Resolved on 2026-10-17 by RFC 026:
   `artifact:read` reads it, including channel account identifiers.
6. **A second factor for campaign-post scheduling (RFC 030).** The owners
   asked for campaign-post scheduling in the API, so it now ships. It follows
   the in-app procedure and asks a session only for `publish:manage`. RFC
   030's table asks for a fresh second factor to create a scheduled post.
   Should a session that schedules a campaign post need one too?
7. **Design approval (RFC 012).** Approving a design's render is a
   `release:approve` session action in the app. It is not part of
   `/api/v1/approvals` yet.

## URL and versioning contract

- Platform endpoints use `/api/v1/{resource}`.
- Resource names are lowercase, plural, and kebab-case.
- Identifiers are opaque strings and must not encode tenant information.
- Breaking request or response changes require a new major URL version.
- Additive fields and endpoints may ship within `v1`.
- Deprecated operations remain available for at least 180 days after a documented replacement is production-ready.
- Deprecation responses include `Deprecation`, `Sunset`, and `Link` headers when a sunset date exists.

## Authentication and workspace selection

Requests use one of these paths:

1. **Workspace API key** in the `X-API-Key` header, for machine callers. The
   OpenAPI security scheme is `workspaceApiKey`. Keys belong to one workspace
   and carry explicit scopes from `lib/auth/api-key-scopes.ts`, such as
   `artifact:read`, `release:create`, `source:write`, and `asset:write`.
2. **User session**, the Better Auth session cookie (`workspaceSession`), for
   same-origin browser calls. A session call is checked against the member's
   role permissions in the active workspace.

Each binding picks its authenticator from `lib/api/route-auth.ts`:
`tenantAccess` accepts either path and names both the API-key scope and the
session permission; `organizationAccess` and `sessionAccess` are
session-based. Workspace shell operations (`me`, `bootstrap`,
`organizations`) are session-only and return `403` when an API key is sent.

A client cannot choose an arbitrary workspace ID to widen access. A requested
workspace is checked against the authenticated principal before use.

### Editor utilities need an account and a paid plan

There is no free plan (RFC 023). `/api/screenshot`, `/api/export`,
`/api/tweet/{id}`, and `/api/image-proxy` call `requirePaidAccess`
(`lib/api/require-account.ts`), which requires a signed-in session or an API
key with `artifact:read`, plus the `workspace:use` feature:

| Condition                                      | Status | Code                             |
| ---------------------------------------------- | ------ | -------------------------------- |
| No session and no valid API key                | `401`  | `unauthorized`                   |
| Authenticated, but lacking scope or permission | `403`  | `forbidden`                      |
| Workspace has no active paid plan              | `403`  | `workspace_feature_not_entitled` |

### Platform headers

Platform-specific headers use the `X-Shots-` prefix: `X-Shots-Signature` on
signed internal and webhook calls, `X-Shots-Event-Id` and `X-Shots-Timestamp`
on inbound source webhooks, and `X-Shots-Maintenance-Secret` on maintenance
routes. The OpenAPI vendor extension for plan requirements is
`x-shots-entitlement`. Header names are declared once in
`lib/api/request-context.ts`.

Scalar may display the API-key input, but it must not persist, log, prefill,
or send credentials anywhere except the selected API request.

## Pricing and enterprise entitlement boundary

Commercial authorization is capability-based and server-resolved. Routes
declare a named feature such as `asset:delete` or `workspace:use`; they do
not compare plan strings inside handlers. `requireTenantAccess` authenticates
the principal, resolves the workspace, verifies scope or permission, then asks
the Go backend for a feature decision and consumes any declared quota, all
before request parsing or domain execution.

The Go backend owns `WorkspaceEntitlement`: the plan, lifecycle status,
optional expiry and grace date, and validated per-feature overrides. Plan
values are `free`, `pro`, `business`, and `enterprise`. `free` is not a plan
anyone buys; it is the state of a workspace without a subscription, and it
has no features and zero allowances. A workspace without an entitlement
record reads as `free`. Suspended, expired, unknown, or malformed records fail
closed. Request data, API-key metadata, and browser state can never assert a
plan or override.

Feature checks, not plan names, are the durable contract. This supports
negotiated enterprise agreements without numeric tier comparisons. Update and
delete have separate capabilities so a contract can permit one without the
other. Pro and higher include `workspace:use`, `asset:create`, `asset:read`,
`asset:update`, `asset:delete`, `release:create`, and `source-app:create`;
Enterprise adds `enterprise:sso`, `enterprise:scim`, and
`enterprise:audit-drain`. `campaign:workflow` is a rollout flag granted only
through overrides. Compatibility routes use the same requirement as their
`/api/v1` counterparts to prevent path-based bypass.

`requireTenantAccess` checks `workspace:use` on every tenant operation before
any declared feature, so every `/api/v1` route and the editor utilities refuse
a workspace without an active subscription with `403
workspace_feature_not_entitled`. The Go backend enforces the same rule on its
writes: `asset:create`, `asset:delete`, `release:create` (API, form, and
webhook ingestion), and `source-app:create`.

Each contract declares its requirement in `access`: the API-key scope (absent
for member-only operations), the session permission, the feature, and the
quota. The route binds exactly that requirement, and the OpenAPI generator
publishes it as the operation's security requirement and its
`x-shots-entitlement` (`feature`, `minimumPlan`, `quota`). Every gated
operation, including the editor utilities, carries the tag.

### Billing synchronization and administration

Stripe events arrive at `POST /api/webhooks/stripe` and are applied through
the signed internal endpoint at `/api/internal/billing/entitlements`
(RFC 023). That endpoint verifies an HMAC over the raw body in the
`X-Shots-Signature` header, requires a provider event ID, and records an
immutable receipt. Replays return the original version without repeating
effects. Every mutation supplies `expectedVersion`; stale concurrent changes
return `409` and never overwrite newer state. Plan changes are written to the
tenant audit log.

Workspace owners may read the entitlement summary through
`/api/enterprise/entitlement` after a fresh sign-in and TOTP. Plan mutation is
service-controlled, so a tenant owner cannot grant themselves paid or
enterprise capabilities.

### Quotas and outage policy

Plans define named quotas for API writes per minute, storage, monthly AI
credits, posts, emails, and concurrent jobs (RFC 023). Metered write routes
declare a quota alongside their feature. The Go backend counts them in Redis
and the web returns `429` with `Retry-After` and `X-RateLimit-*` headers.
Costly writes fail closed when the counter is unavailable; reads remain
available.

The Go backend evaluates the entitlement on every check; the web keeps no
entitlement cache. `active` and `trialing` are usable. `past_due` remains
usable until the server-owned grace date. Cancelled, unpaid, and paused
subscriptions return the workspace to `free`, which keeps its data but locks
it. Downgrades take effect as soon as the sync commits.

## Request contract

- JSON request bodies use `Content-Type: application/json`.
- Uploads use signed upload URLs.
- Zod schemas validate path, query, header, and body inputs at the route boundary.
- `route` is the sole owner of input parsing; endpoint code never parses request values itself.
- Unknown fields are rejected for mutation requests unless a resource RFC explicitly allows them.
- Timestamps use RFC 3339 UTC strings.
- Pagination uses an opaque `cursor` and bounded `limit`.
- Retryable mutations accept `Idempotency-Key` with a maximum length of 128 characters.
- Request bodies have route-specific size limits.

## Response contract

Successful single-resource responses return the resource directly. Collections use:

```json
{
  "data": [],
  "pagination": {
    "nextCursor": null,
    "hasMore": false
  }
}
```

Creation returns `201 Created`. Idempotent replay may return `200 OK` with the
original result. Deletion returns `204 No Content`, or `202 Accepted` when it
is queued.

Every response includes `X-Request-Id`. A caller-supplied `X-Request-Id` is
kept when valid and forwarded to the Go backend. Rate-limited responses
include `Retry-After` and the `X-RateLimit-*` headers.

## Error contract

All public JSON failures use one envelope:

```json
{
  "error": "Human-readable summary",
  "code": "stable_machine_code",
  "message": "Human-readable summary",
  "hint": "Action the caller can take",
  "status": 400,
  "documentation": "https://shots.playbookmedia.io/api-reference#errors"
}
```

Validation failures may add an `issues` array with field paths and messages.
Error codes are stable within an API major version. Internal exceptions,
provider payloads, SQL errors, secrets, and stack traces are never returned.

## OpenAPI ownership

- `lib/api/openapi.ts` assembles the document; `lib/api/openapi-platform.ts` generates the platform half from the contracts.
- Every public operation has a unique, stable `operationId`, declared in its contract.
- Every operation declares authentication, scopes, request schemas, success schemas, error schemas, and rate-limit behavior.
- Internal routes are excluded.
- CI validates the document shape and checks that every contract is served by the route file its path names.
- `npm run api:generate` writes the document to `server/internal/shotsapi/openapi.json` and generates the typed client in `clients/packages/shots-api-client` from it with `openapi-typescript`. The Go MCP server (RFC 026) embeds the same file.
- CI regenerates both and fails on any difference. It then compares the document with the base revision using oasdiff and fails any breaking change that `server/internal/shotsapi/breaking-changes-allowed.txt` does not list.

## Endpoint extension framework

Platform endpoints declare a zod contract with `defineContract` from
`lib/api/contract.ts` in `lib/api/contracts/`, then bind it in the Route
Handler with `route` from `lib/api/route.ts`. The contract names the method and
path and holds the schemas for path params, query, headers, body, and the
response. The binding makes the remaining decisions:

1. the authenticator from `lib/api/route-auth.ts`;
2. an optional feature and quota, in the tenant requirement;
3. the domain call to execute, in `handler`, through the backend SDK;
4. an optional `status` picker when an operation has more than one success status.

`route` runs one fixed pipeline. It authenticates before any input is read,
parses every request location with the contract schemas, invokes the handler,
and parses the result through the response schema, so fields outside the
contract never reach a caller. Handlers must not call tRPC or duplicate domain
logic.

`test/openapi-contracts.test.ts` checks that every contract is served by the
route file its path names, and `test/api-platform-boundary.test.ts` checks
that every fork route goes through `route`, uses only zod-derived types, and
carries TSDoc on every export. Every file below `app/api/v1` must have a
one-to-one OpenAPI path; the validator at
`.agents/skills/add-rest-api-endpoint/scripts/validate-rest-api.ts` enforces it.

## Endpoint authoring skill

The `add-rest-api-endpoint` skill at
`.agents/skills/add-rest-api-endpoint/SKILL.md` is the procedure for adding or
changing a public REST operation. It covers route naming and versioning,
framework use and tenant authorization, zod parsing and idempotency, OpenAPI
and Scalar registration, and the verification gates. Detailed contracts live
in its `references/contracts.md`.

## Scalar reference

`/api-reference` (`app/api-reference/route.ts`) uses
`@scalar/nextjs-api-reference` and loads `/openapi.json`. The reference is
public and read-only except for requests a user starts in Scalar's client.

As configured:

- it loads without authentication and is titled "Shots API Reference";
- it is themed to match the site and fixed to dark mode;
- the `workspaceApiKey` scheme is preselected, and curl is the default example client;
- Scalar's agent, MCP, and developer tools are disabled, and telemetry is off;
- it renders the same production OpenAPI document machines fetch.

## Security and privacy

- Tenant authorization happens in the handler, never only in documentation or UI.
- API keys are hashed at rest and shown only when created.
- Logs redact authorization, cookies, signed URLs, and sensitive request fields.
- Scalar loads only the public OpenAPI document and approved static assets.
- A future strict CSP must use a per-request nonce for Scalar scripts and must not weaken the rest of the application policy.
- Public OpenAPI access does not imply permissive CORS for authenticated operations.
- Rate limits apply per workspace.

## Audit and observability

Each request records or propagates:

- request ID;
- operation ID;
- authenticated principal and workspace;
- response status and duration;
- rate-limit decision;
- idempotency outcome for mutations;
- audit event ID for security-sensitive state changes.

Metrics distinguish documentation traffic from API traffic. Alerts cover
elevated 5xx rates, authorization failures, latency, and sustained rate-limit
pressure.

## Rollout

### Phase 1: discoverability (shipped)

- Scalar at `/api-reference`, the OpenAPI document at `/openapi.json` and `/.well-known/openapi.json`.
- Links from the developer docs.

### Phase 2: versioned tenant API (shipped)

- Zod contracts and `route` for every platform endpoint, with the OpenAPI platform half generated from them.
- `/api/v1` for releases, source apps, signed asset uploads, upload completion, signed downloads, asset deletion, link preview, and the workspace shell.
- API-key and session security schemes, scopes, pagination, and request IDs in OpenAPI.
- `/api/tenant/*` kept as compatibility adapters until consumers migrate.

### Phase 3: resources and client ecosystem (shipped)

- `/api/v1` resources for campaigns, approvals, and scheduled posts, as
  defined above, with tenant-isolation checks in
  `scripts/verify-tenant-isolation.ts`.
- `access` on every contract, published as security scopes and
  `x-shots-entitlement` on every gated operation.
- A quickstart, authentication, plans, idempotency, and errors guide in the
  document's description, which Scalar renders above the operations.
- A typed client generated from the production document, and an OpenAPI diff
  in CI that blocks unintended breaking changes.
- API and documentation smoke tests (`test/verify-agent-endpoints.ts`) run
  in CI against the local stack.

## Acceptance criteria

- `GET /api-reference` returns `200`, HTML, the Shots API Reference title, and a Scalar bootstrap script.
- The Scalar page references `/openapi.json` rather than embedding a divergent contract.
- `GET /openapi.json` and `GET /.well-known/openapi.json` return the same valid OpenAPI 3.1 document.
- Every documented public path has a stable `operationId` and declared responses.
- Unknown `/api/*` paths return the standardized JSON `404` envelope.
- Authenticated `/api/v1` routes cannot cross workspace boundaries in tenant-isolation verification.
- Editor utility endpoints return `401 unauthorized` without credentials and `403 workspace_feature_not_entitled` for a workspace without a paid plan.
- Plan-gated operations reject `free`, expired, and suspended workspaces before domain execution, while validated enterprise overrides are honored.
- REST, compatibility routes, tRPC, jobs, and direct destructive domain calls cannot bypass the same feature policy.
- Billing event replays are idempotent, stale versions return `409`, and entitlement changes produce tenant audit records.
- Every gated operation declares its feature, minimum plan, and quota in `x-shots-entitlement`.
- Mutation retries with the same idempotency key cannot create duplicate durable effects.
- Documentation and API smoke tests run in CI.

## Evidence and references

- Dub source: <https://github.com/dubinc/dub>
- Dub web application package and OpenAPI generation workflow: <https://github.com/dubinc/dub/blob/main/apps/web/package.json>
- Scalar Next.js integration: <https://github.com/scalar/scalar/blob/main/documentation/integrations/nextjs.md>
- Next.js 16 Route Handlers: `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`
