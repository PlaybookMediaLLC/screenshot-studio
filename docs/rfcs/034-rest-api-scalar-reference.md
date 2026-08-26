# RFC 034: First-Class REST API and Scalar Reference

**Status:** Accepted  
**Date:** 2026-08-26  
**Owners:** Platform Engineering  
**Depends on:** RFC 002, RFC 003, RFC 007

## Decision

Screenshot Studio will ship a versioned, workspace-aware REST API as a first-class product surface. The same Next.js application will publish:

- interactive Scalar documentation at `/api-reference`;
- the canonical OpenAPI 3.1 document at `/openapi.json` and `/.well-known/openapi.json`;
- stable JSON endpoints under `/api/v1` for new platform operations;
- the existing editor-oriented endpoints under `/api` until they can be versioned without breaking users.

The OpenAPI document is the public contract. Scalar renders that contract and provides request examples and an interactive client. It must not become a second, manually maintained description of the API.

## Context

The application already has Next.js Route Handlers, standardized JSON errors, an OpenAPI 3.1 document, anonymous editor endpoints, and authenticated tenant endpoints. It does not have an interactive API explorer, and its tenant endpoints are not yet organized into a stable public version namespace.

Dub's open-source application is useful prior art for treating the web application and HTTP API as one product: route handlers live with the Next.js application, operations have typed schemas, and the API contract can drive SDK and documentation workflows. Screenshot Studio will adopt that product boundary while using Scalar for the interactive reference.

## Goals

- Give engineers one discoverable, interactive reference for every supported REST operation.
- Make API-key calls and browser-session calls enforce the same workspace authorization rules.
- Establish `/api/v1` before expanding the platform API.
- Keep OpenAPI operation IDs, request schemas, response schemas, examples, and implementation behavior synchronized.
- Preserve request IDs, auditability, idempotency, rate limits, and tenant isolation.
- Support future generated clients without making a generated SDK part of this RFC.

## Non-goals

- Replacing tRPC for the first-party browser application.
- Immediately moving or removing existing `/api/screenshot`, `/api/export`, or other editor endpoints.
- Exposing internal Trigger.dev dispatch routes.
- Publishing database-shaped CRUD endpoints.
- Supporting GraphQL.
- Generating or publishing an SDK in the first rollout.

## Public surface

| URL                                              | Purpose                              | Authentication                             |
| ------------------------------------------------ | ------------------------------------ | ------------------------------------------ |
| `/api-reference`                                 | Scalar interactive API documentation | Public                                     |
| `/openapi.json`                                  | Canonical OpenAPI 3.1 document       | Public                                     |
| `/.well-known/openapi.json`                      | Well-known alias for discovery       | Public                                     |
| `/api/v1/*`                                      | Versioned platform REST API          | API key or supported user session          |
| `/api/screenshot`, `/api/export`, `/api/tweet/*` | Existing editor REST operations      | Existing per-route policy                  |
| `/api/internal/*`                                | Service-only operations              | Never included in the public specification |

## Resource model

The first `/api/v1` resources mirror product concepts rather than database tables:

- `releases`
- `assets`
- `source-apps`
- `campaigns`
- `approvals`
- `scheduled-posts`

A resource may be added only when its authorization, lifecycle, idempotency, and audit behavior are defined in its owning RFC.

## URL and versioning contract

- New platform endpoints use `/api/v1/{resource}`.
- Resource names are lowercase, plural, and kebab-case.
- Identifiers are opaque strings and must not encode tenant information.
- Breaking request or response changes require a new major URL version.
- Additive fields and endpoints may ship within `v1`.
- Deprecated operations remain available for at least 180 days after a documented replacement is production-ready.
- Deprecation responses include `Deprecation`, `Sunset`, and `Link` headers when a sunset date exists.

## Authentication and workspace selection

Requests use one of these paths:

1. `Authorization: Bearer <workspace-api-key>` for machine callers.
2. The authenticated application session for supported same-origin browser calls.

API keys carry explicit scopes. Every handler calls the shared tenant-access boundary before reading or mutating tenant data. A client cannot choose an arbitrary workspace ID to widen access. If a workspace selector is accepted, it is checked against the authenticated principal before use.

Scalar may display the bearer-token input, but it must not persist, log, prefill, or send credentials anywhere except the selected API request.

## Request contract

- JSON request bodies use `Content-Type: application/json`.
- Upload operations use documented multipart fields or signed upload URLs.
- Zod schemas validate path, query, header, and body inputs at the route boundary.
- The REST framework requires a Zod schema for every authenticated JSON operation and is the sole owner of the `parseAsync` call.
- Unknown fields are rejected for mutation requests unless a resource RFC explicitly allows them.
- Timestamps use RFC 3339 UTC strings.
- Pagination uses an opaque `cursor` and bounded `limit`.
- Mutation requests that can be retried accept `Idempotency-Key` with a maximum length of 128 characters.
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

Creation returns `201 Created`. Idempotent replay may return `200 OK` with the original result. Deletion returns `204 No Content` unless the resource requires a terminal-state representation.

Every response includes `X-Request-Id`. Rate-limited responses include `Retry-After` and the documented `X-RateLimit-*` headers.

## Error contract

All public JSON failures use one envelope:

```json
{
  "error": "Human-readable summary",
  "code": "stable_machine_code",
  "message": "Human-readable summary",
  "hint": "Action the caller can take",
  "status": 400,
  "documentation": "https://www.screenshot-studio.com/api-reference"
}
```

Validation failures may add an `issues` array containing field paths and messages. Error codes are stable within an API major version. Internal exceptions, provider payloads, SQL errors, secrets, and stack traces are never returned.

## OpenAPI ownership

- `lib/api/openapi.ts` is the canonical assembled specification during the first phase.
- Every public operation has a unique, stable `operationId`.
- Every operation declares authentication, scopes, request schemas, success schemas, error schemas, and rate-limit behavior.
- Internal routes and session-only application implementation details are excluded.
- CI validates the document shape and verifies that documented public paths respond.
- Longer term, resource-level schemas may generate OpenAPI fragments from the same Zod definitions used by handlers. That migration must preserve stable operation IDs.

## Endpoint extension framework

New authenticated JSON endpoints use `createTenantJsonRoute` from
`lib/api/v1/route.ts`. The framework keeps each Route Handler declarative and
requires four explicit decisions:

1. the API-key scope and browser-session permission;
2. a required Zod schema plus an extractor for untrusted request values;
3. the tenant domain service to execute;
4. an optional response mapper for non-`200` behavior.

The framework resolves `TenantContext`, applies the shared authorization
boundary, validates the extractor result with `schema.parseAsync`, and only then
invokes the domain service. Endpoint code must not manually parse or bypass this
Zod boundary. Inputs spanning path, query, headers, and body use one composed
Zod object so the complete operation contract remains inspectable. Domain
logic remains in `lib/tenant`; handlers must not call tRPC or duplicate service
logic.

Every file below `app/api/v1` must have a one-to-one OpenAPI path. The
deterministic registry validator at
`.agents/skills/add-rest-api-endpoint/scripts/validate-rest-api.ts` enforces
that invariant.

## Endpoint authoring skill

The repository ships the `add-rest-api-endpoint` skill at
`.agents/skills/add-rest-api-endpoint/SKILL.md`. Use it whenever adding or
changing a public REST operation. The skill defines:

- route naming and versioning rules;
- framework usage and tenant authorization requirements;
- Zod parsing and idempotency conventions;
- OpenAPI and Scalar registration;
- contract, tenant-isolation, build, and production verification gates.

Detailed contracts live in the skill's `references/contracts.md`. Keeping this
workflow in the repository makes endpoint expansion repeatable for engineers
and coding agents rather than dependent on institutional memory.

## Scalar reference

The Next.js route at `/api-reference` uses `@scalar/nextjs-api-reference` and loads `/openapi.json`. The reference is public and read-only except for requests users explicitly initiate through Scalar's client.

The page must:

- load successfully without authentication;
- show the current API title and operations;
- support dark and light browser preferences;
- offer copyable examples and interactive requests;
- expose bearer authentication only for operations that declare it;
- avoid indexing secrets or retaining them server-side;
- use the same production OpenAPI document available to machines.

## Security and privacy

- Tenant authorization happens in the handler, never only in documentation or UI.
- API keys are hashed at rest and shown only when created.
- Logs redact authorization, cookies, signed URLs, and sensitive request fields.
- Scalar loads only the public OpenAPI document and approved static assets.
- A future strict CSP must use a per-request nonce for Scalar scripts and must not weaken the rest of the application policy.
- Browser-executed requests remain subject to the explicit origin policy. Public OpenAPI access does not imply permissive CORS for authenticated operations.
- Rate limits apply by workspace/API key and, where useful, by IP.

## Audit and observability

Each request records or propagates:

- request ID;
- operation ID;
- authenticated principal and workspace;
- response status and duration;
- rate-limit decision;
- idempotency outcome for mutations;
- audit event ID for security-sensitive state changes.

Metrics must distinguish documentation traffic from API operation traffic. Alerts cover elevated 5xx rates, authorization failures, latency, and sustained rate-limit pressure.

## Rollout

### Phase 1: discoverability

- Publish Scalar at `/api-reference`.
- Continue publishing the existing OpenAPI document.
- Link Scalar from the developer portal and README-facing developer resources.
- Add smoke coverage for the Scalar HTML and OpenAPI fetch.

### Phase 2: versioned tenant API

- Introduce `/api/v1` route handlers for the first approved resources.
- Reuse tenant services and authorization from the tRPC surface.
- Add bearer security schemes, scopes, pagination, request IDs, and audit events to OpenAPI.
- Keep current tenant routes as compatibility adapters until consumers migrate.

Initial Phase 2 operations cover releases, source apps, signed asset uploads,
asset completion, signed asset downloads, and asset deletion.

### Phase 3: client ecosystem

- Generate a typed client from the production OpenAPI contract.
- Publish examples and automation recipes.
- Add contract-diff checks that block unintended breaking changes.

## Acceptance criteria

- `GET /api-reference` returns `200`, HTML, the Screenshot Studio API title, and a Scalar bootstrap script.
- The Scalar page references `/openapi.json` rather than embedding a divergent contract.
- `GET /openapi.json` and `GET /.well-known/openapi.json` return the same valid OpenAPI 3.1 document.
- Every documented public path has a stable `operationId` and declared responses.
- The developer portal links to the interactive reference and raw specification.
- Unknown `/api/*` paths still return the standardized JSON `404` envelope.
- Authenticated `/api/v1` routes cannot cross workspace boundaries in tenant-isolation verification.
- Mutation retries with the same idempotency key cannot create duplicate durable effects.
- Documentation and API smoke tests run in CI.

## Evidence and references

- Dub source: <https://github.com/dubinc/dub>
- Dub web application package and OpenAPI generation workflow: <https://github.com/dubinc/dub/blob/main/apps/web/package.json>
- Scalar Next.js integration: <https://github.com/scalar/scalar/blob/main/documentation/integrations/nextjs.md>
- Next.js 16 Route Handlers: `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`
