# End-to-end test framework

Run all browser flows against the running local stack:

```sh
make e2e
```

Use `test` and `configureE2EFlow` for every flow. They provide a fresh browser page, a unique
local user identity, path helpers, and lifecycle hooks. New specs in `e2e/` run
automatically in local `make e2e` and CI.

```ts
import { configureE2EFlow, test } from './framework/flow'

configureE2EFlow({
  beforeEach: async ({ app }) => app.open('/releases'),
  afterEach: async ({ page }) => page.context().clearCookies(),
  onFailure: async ({ testInfo }, error) => {
    await testInfo.attach('flow-error', {
      body: String(error),
      contentType: 'text/plain',
    })
  },
})

test('creates a release', async ({ app, identity, page }) => {
  // Complete and assert the user-visible flow.
})
```

The framework automatically attaches the test email and workspace name on a
failure. It never writes the test password to an artifact.

`e2e/framework/services.ts` creates a disposable direct Postgres or MinIO
client for durable assertions. Use it only after a user-visible API action.
The test runner provides host-safe connection values in `E2E_*` variables; do
not use an app container hostname from a browser test.

## Downstream boundaries

Use `mockBrowserJson` for a browser-originated third-party request. It returns
the configured JSON response and records calls for assertions. For server-side
egress and real dependency validation, follow
[`downstream-dependencies.md`](../.agents/skills/add-e2e-flow/references/downstream-dependencies.md).

- Run destructive dependency failure cases in `make e2e-recovery`, not in the
  parallel browser suite. It restores every service in a `finally` block.
