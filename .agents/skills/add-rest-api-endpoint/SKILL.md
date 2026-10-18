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
4. Declare the operation with `defineContract` from `lib/api/contract.ts` in the owning file under `lib/api/contracts/`. Supply:
   - `access`: `{ apiKeyScope, permission, feature?, quota? }` for a tenant operation, or `{ permission, feature?, quota?, sensitive? }` without a scope for an operation only a signed-in member may perform;
   - `name`, `method`, `path`, `summary`, and the default success `status`;
   - Zod schemas for `params`, `query`, `headers`, and `body`, whichever the operation reads;
   - an `output` schema wrapped in `mirrors<SourceType>()` so a field the schema would drop fails the build;
   - `docs` with a stable `operationId`, tag, security, and a description for every documented status.
5. Bind the contract in the route file with `route` from `lib/api/route.ts`:
   - `auth: tenantAccess(contract.access)`, or `memberAccess(contract.access)` for a member-only operation, from `lib/api/route-auth.ts`;
   - `handler`, which receives the parsed `params`, `query`, `headers`, `body`, and the resolved `access`;
   - `status` only when the operation has more than one success status.
     The framework, not the endpoint, parses every request location and the response. Do not parse manually.
6. Never accept `organizationId` as authorization. `tenantAccess` resolves workspace ownership through `requireTenantAccess`.
   Never accept a plan, billing status, or entitlement from the request. The framework resolves it from the authenticated workspace.
7. Add the contract to `documentedContracts` in `lib/api/contracts/index.ts`. `lib/api/openapi-platform.ts` generates the OpenAPI operation, its security scopes, and its `x-shots-entitlement`, and Scalar reads it automatically. Run `npm run api:generate` to refresh the committed document and the typed client.
8. Add a focused contract test and extend `test/verify-agent-endpoints.ts` when the route can be exercised without destructive durable effects.
9. Run the deterministic registry check, formatting, lint, typecheck, tests, and a production build.

## Route template

```ts
// lib/api/contracts/examples.ts
/** `POST /api/v1/examples` */
export const createExampleContract = defineContract({
  access: { apiKeyScope: 'example:write', permission: 'artifact:edit', quota: 'api:write:minute' },
  body: exampleCreateSchema,
  docs: workspaceDocs({
    description: 'Creates an example in the API key workspace. Requires the `example:write` scope.',
    operationId: 'createExample',
    responses: { '201': 'Example created.', '400': 'The example input is invalid.' },
    tag: 'Workspace',
  }),
  method: 'POST',
  name: 'examples.create',
  output: z.object({ example: mirrors<Example>()(exampleSchema) }),
  path: '/api/v1/examples',
  status: 201,
  summary: 'Create an example',
})

// app/api/v1/examples/route.ts
/** Create an example. */
export const POST = route(createExampleContract, {
  auth: tenantAccess(createExampleContract.access),
  handler: async ({ access, body }) => ({ example: await createExample(access, body) }),
})
```

For dynamic paths, declare a `params` schema such as `z.object({ exampleId: z.string().uuid() })`; the handler receives the parsed `params`.

## Contract rules

- Keep `/api/v1` additive. Require a new major version for breaking request or response changes.
- Every route declares its Zod contract and goes through `route`. Endpoint-local calls to `parse`, `safeParse`, or ad hoc validation are not substitutes; `test/api-platform-boundary.test.ts` enforces this, along with zod-only types and TSDoc on every export.
- Gate commercial capabilities by named feature, not a client-supplied plan or scattered `if (plan === ...)` checks. Define plan defaults and contract overrides in `lib/billing/plans.ts`.
- Put update and delete entitlement checks in the shared access boundary before request parsing or domain execution. Compatibility routes must use the same gate so callers cannot bypass pricing through an older path.
- Enforce destructive feature checks again in the owning domain service so tRPC, jobs, support tooling, and future transports cannot bypass the route declaration.
- Declare the feature and quota in `access`; the generator adds `x-shots-entitlement` with the feature, minimum default plan, and quota. Declare standardized `403` and `429` schemas.
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
npm run api:generate && git diff --exit-code -- services/internal/shotsapi packages/shots-api-client/src
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
- `test/openapi-contracts.test.ts` verifies that every contract is bound by the route file its path names.
