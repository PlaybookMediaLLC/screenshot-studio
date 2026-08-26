# REST API Contract Reference

## Paths and methods

Place public platform routes under `app/api/v1`. Use plural kebab-case resource names. Model actions as subresources only when ordinary CRUD semantics are misleading, such as `/{assetId}/complete` or `/{assetId}/download-url`.

Do not expose `app/api/internal`, webhook receivers, Better Auth handlers, or tRPC transport routes through the public OpenAPI document.

## Authentication

Use `createTenantJsonRoute` for workspace JSON operations. Declare both the API-key scope and browser-session permission. The helper resolves `TenantContext` and converts thrown authorization, validation, workflow, storage, and dependency failures through the shared route-error boundary.

Every route supplies a Zod `schema` and an `input` extractor. The extractor returns untrusted values without parsing. The framework owns the single `schema.parseAsync` call before the domain service can execute, so async refinements, coercion, defaults, and validation errors behave consistently across endpoints.

Never authorize from an input workspace ID. Pass the resolved tenant context to domain services and scope every read or write with `tenant.organizationId`.

## Pricing and enterprise entitlements

Declare a named `feature` in the route access requirement when an operation is commercially gated. `requireTenantAccess` resolves the authenticated workspace, then loads the server-owned `WorkspaceEntitlement` before input parsing or domain execution. Missing records use the conservative free-plan defaults. Expired, suspended, unknown, or malformed entitlement data fails closed for paid capabilities.

Plan defaults live in `lib/billing/plans.ts`. Enterprise contracts may grant or revoke individual named features with validated overrides, which avoids treating custom enterprise agreements as a simple numeric tier. Never read plan or entitlement claims from request bodies, headers, API-key metadata, or route parameters.

Update and delete operations require explicit entitlement review. Apply the same feature gate to compatibility handlers and other transports until they are retired, otherwise an older endpoint can bypass the commercial boundary.

## Parsing

Validate all untrusted data before executing the domain service:

- body through an owning Zod object schema;
- query through `Object.fromEntries(request.nextUrl.searchParams)` and a bounded schema;
- path parameters after awaiting the Next.js 16 `params` promise;
- idempotency keys with a 128-character maximum;
- content type and byte limits before signing uploads.

For inputs spanning multiple request locations, define one composed Zod object such as `{ params, query, headers, body }`. This keeps the full operation input contract inspectable and reusable instead of scattering validation across callbacks.

## Responses

Use the default framework response for `200` JSON. Supply `respond` for `201`, `202`, `204`, idempotent replay, binary responses, or custom headers.

Return opaque product IDs and public metadata. Prefer signed short-lived URLs over storage locations. Ensure error responses do not include stack traces, provider payloads, SQL errors, or authorization internals.

## OpenAPI and Scalar

Add every public method to `lib/api/openapi.ts` with:

- a unique camelCase `operationId`;
- summary and selection-quality description;
- `Workspace` or owning resource tag;
- `security: [{ bearerAuth: [] }]` for authenticated operations;
- path, query, and header parameters;
- request body and response schemas;
- all expected failure statuses.

Reuse component schemas and parameters. Keep the raw document at `/openapi.json`; Scalar at `/api-reference` consumes it without separate configuration.

## Compatibility

Treat additive fields as compatible within v1. Treat removed fields, stricter accepted values, changed meanings, and altered status behavior as breaking. Preserve old routes as adapters during migration. Add `Deprecation`, `Sunset`, and `Link` headers before removal.

## Testing

Cover schema boundaries and handler-to-domain wiring in unit tests. Exercise the built Next.js server for route existence, content type, authentication failure, and Scalar visibility. Verify tenant isolation with real organization A and B records whenever an identifier selects stored data.
