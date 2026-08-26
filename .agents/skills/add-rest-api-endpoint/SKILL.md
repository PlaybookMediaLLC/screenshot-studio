---
name: add-rest-api-endpoint
description: This skill should be used when the user asks to "add a REST endpoint", "add an API route", "expose a tenant operation over REST", "document an endpoint in Scalar", "add an OpenAPI operation", or "expand the v1 API" in Screenshot Studio.
---

# Add REST API Endpoint

Add versioned public operations to the existing Next.js application without duplicating domain logic. Read RFC 002, RFC 003, RFC 007, and RFC 034 before changing the REST surface.

## Workflow

1. Name the product action, owning workspace resource, HTTP method, and required API-key scope.
2. Reuse an existing domain service. Avoid calling tRPC from a Route Handler and avoid copying business logic out of `lib/tenant`.
3. Add the handler below `app/api/v1`. Use plural kebab-case resources and opaque identifiers.
4. Build authenticated JSON handlers with `createTenantJsonRoute` from `lib/api/v1/route.ts`. Supply:
   - one explicit API-key scope and browser-session permission;
   - a required Zod `schema` that defines the complete route input contract;
   - an `input` function that only extracts untrusted path, query, header, and body values;
   - an `execute` function that receives the server-resolved `TenantContext`;
   - a `respond` function only when the default `200` JSON response is insufficient.
     The framework, not the endpoint, calls `schema.parseAsync`. Do not parse manually or bypass this Zod boundary.
5. Never accept `organizationId` as authorization. Resolve workspace ownership through `requireTenantAccess` inside the framework.
6. Add the exact path, method, stable `operationId`, security requirement, schemas, and responses to `lib/api/openapi.ts`. Scalar reads this document automatically.
7. Add a focused contract test and extend `tests/verify-agent-endpoints.ts` when the route can be exercised without destructive durable effects.
8. Run the deterministic registry check, formatting, lint, typecheck, tests, and a production build.

## Route template

```ts
import { NextResponse } from 'next/server'
import { createTenantJsonRoute } from '@/lib/api/v1/route'
import { inputSchema } from '@/lib/tenant/schemas'
import { performAction } from '@/lib/tenant/example'

export const POST = createTenantJsonRoute({
  access: { apiKeyScope: 'example:write', permission: 'artifact:edit' },
  schema: inputSchema,
  input: (request) => request.json(),
  execute: (tenant, input) => performAction(tenant, input),
  respond: (result) => NextResponse.json(result, { status: 201 }),
})
```

For dynamic paths, accept the provided route context in `input`, await `context.params`, and return those raw values as part of the object validated by the route's Zod `schema`.

## Contract rules

- Keep `/api/v1` additive. Require a new major version for breaking request or response changes.
- Every authenticated JSON route must declare its Zod schema through the framework. Endpoint-local calls to `parse`, `safeParse`, or ad hoc validation are not substitutes.
- Reject unknown mutation fields unless the owning RFC explicitly permits them.
- Accept `Idempotency-Key` for retriable durable mutations.
- Return only safe product data. Never return secrets, cookies, raw API keys, provider tokens, internal storage keys, or permanent object URLs.
- Declare every expected `2xx`, `4xx`, and dependency `503` response in OpenAPI.
- Keep internal dispatch, webhook verification, and support routes outside the public specification.
- Preserve the existing route during migrations and make the v1 handler a thin adapter over the same domain service.

## Verification

Run:

```bash
npx tsx .agents/skills/add-rest-api-endpoint/scripts/validate-rest-api.ts
npm run format:check
npm run lint -- --max-warnings=0
npm run typecheck
npm test
DATABASE_URL='postgresql://user:password@127.0.0.1:5432/screenshot_studio' npm run build
```

Test the happy path, invalid input, missing authentication, missing scope, and an organization-A to organization-B identifier attack. Use `scripts/verify-tenant-isolation.ts` when the operation reads or mutates stored tenant data.

## Additional resources

- `references/contracts.md` documents path, authentication, OpenAPI, errors, and rollout conventions.
- `scripts/validate-rest-api.ts` verifies that every `/api/v1` Route Handler is represented in OpenAPI and every documented v1 operation has a handler.
