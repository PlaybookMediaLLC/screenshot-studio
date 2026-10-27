# REST API Contract Reference

## Paths and methods

Place public platform routes under `app/api/v1`. Use plural kebab-case resource names. Model actions as subresources only when ordinary CRUD semantics are misleading, such as `/{assetId}/complete` or `/{assetId}/download-url`.

Do not expose `app/api/internal`, webhook receivers, Better Auth handlers, or tRPC transport routes through the public OpenAPI document.

## Authentication

Declare who may call an operation in the contract's `access`, then bind it with `route(contract, { auth: tenantAccess(contract.access), handler })`:

- a tenant operation names `apiKeyScope` and `permission` (and an optional `feature` and `quota`), and accepts an API key or a member session;
- a human-only operation, such as approving content or scheduling a post, omits `apiKeyScope`, binds `memberAccess(contract.access)`, and refuses API keys with `403`; add `sensitive: true` when it needs a fresh sign-in with two-factor.

The OpenAPI generator publishes `access` as the operation's security requirement (the API-key scope, or the session alone) and its `x-shots-entitlement`, and the Go MCP server reads the same fields from the embedded document, so a scope or plan gate is declared once. `test/openapi-contracts.test.ts` fails when a route binds anything else. `tenantAccess` resolves `TenantContext`, and `route` converts thrown authorization, validation, workflow, storage, and dependency failures through `toApiFailure` in `lib/api/platform-errors.ts`, the same mapping tRPC uses.

Every contract supplies Zod schemas for the request locations it reads. `route` authenticates first, then owns the single parse of each location before the domain service can execute, so async refinements, coercion, defaults, and validation errors behave consistently across endpoints.

Never authorize from an input workspace ID. Pass the resolved tenant context to domain services and scope every read or write with `tenant.organizationId`.

## Pricing and enterprise entitlements

Declare a named `feature` in the route access requirement when an operation is commercially gated. `requireTenantAccess` resolves the authenticated workspace, then loads the server-owned `WorkspaceEntitlement` before input parsing or domain execution. Missing records use the conservative free-plan defaults. Expired, suspended, unknown, or malformed entitlement data fails closed for paid capabilities.

Plan defaults live in `lib/billing/plans.ts`. Enterprise contracts may grant or revoke individual named features with validated overrides, which avoids treating custom enterprise agreements as a simple numeric tier. Never read plan or entitlement claims from request bodies, headers, API-key metadata, or route parameters.

Update and delete operations require explicit entitlement review. Apply the same feature gate to compatibility handlers and other transports until they are retired, otherwise an older endpoint can bypass the commercial boundary.

Destructive and high-value domain services repeat the feature assertion as defense in depth. tRPC procedures use the same `feature` and `quota` fields as REST. Distributed quotas use Redis and fail closed for costly writes when the counter is unavailable. Entitlement reads use a bounded cache; billing synchronization invalidates it after the audited transaction commits.

OpenAPI operations expose `x-shots-entitlement` (`feature`, `minimumPlan`, and the `quota` the route consumes) so Scalar, generated clients, the MCP server, and policy tooling can read the gate without scraping descriptions. It is generated from `access`; never write it by hand. A quota the backend meters itself, such as monthly posts, is described in the operation description instead, so no caller consumes it twice.

## Parsing

Validate all untrusted data before executing the domain service:

- body through the contract's `body` schema;
- query through the contract's `query` schema;
- path parameters through the contract's `params` schema;
- headers through the contract's `headers` schema, keyed by lowercase name; idempotency keys have a 128-character maximum and longer keys are rejected;
- content type and byte limits before signing uploads.

Each request location has its own schema on the contract, so the full operation input remains inspectable in one place and a body field can never override a path parameter.

## Responses

Set the contract's `status` for `201`, `202`, or `204`. Supply a binding `status` picker for idempotent replay. Every response is parsed through the contract's `output` schema, which drops fields outside the contract; wrap it in `mirrors<SourceType>()` so a dropped field fails the build instead. A handler may return `errorResponse(status, message)` for a rejection it detects after authorization.

Return opaque product IDs and public metadata. Prefer signed short-lived URLs over storage locations. Ensure error responses do not include stack traces, provider payloads, SQL errors, or authorization internals.

## OpenAPI and Scalar

Give every public contract `docs` and list it in `documentedContracts`. `lib/api/openapi-platform.ts` generates the operation from the contract:

- the unique camelCase `operationId`, summary, and selection-quality description;
- the `Workspace` or owning resource tag and the security scheme;
- path, query, and header parameters from the contract schemas;
- request body and response schemas, named through `bodyName` and `outputName` when reused;
- a description for every expected success and failure status.

Keep the raw document at `/openapi.json`; Scalar at `/api-reference` consumes it without separate configuration.

After changing a contract, run `npm run api:generate` in `clients/`. It writes the document to `server/internal/shotsapi/openapi.json` (embedded by the Go MCP server) and regenerates the typed client in `clients/packages/shots-api-client`. CI fails when either is stale, and runs `oasdiff` against the base branch to fail any breaking change that is not listed in `server/internal/shotsapi/breaking-changes-allowed.txt`.

## Compatibility

Treat additive fields as compatible within v1. Treat removed fields, stricter accepted values, changed meanings, and altered status behavior as breaking. Preserve old routes as adapters during migration. Add `Deprecation`, `Sunset`, and `Link` headers before removal.

## Testing

Cover schema boundaries and handler-to-domain wiring in unit tests. Exercise the built Next.js server for route existence, content type, authentication failure, and Scalar visibility. Verify tenant isolation with real organization A and B records whenever an identifier selects stored data.
