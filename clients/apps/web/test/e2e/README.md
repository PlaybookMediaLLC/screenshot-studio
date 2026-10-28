# End-to-end test framework

Run all browser flows against the running local stack:

```sh
make e2e
```

Run one file, with Playwright options after the path:

```sh
./dev/studio e2e-file test/e2e/settings-usability.spec.ts --workers=4 --repeat-each=2
```

New specs in `test/e2e/` run automatically in local `make e2e` and in CI.

## Two lanes

Next.js recommends browser tests against a production build, and a
production build serves pages about 4 times faster than `next dev` (median
test 3.1 s against 15.0 s, measured on 12 specs). `dev/studio e2e` therefore
runs two lanes, one after the other:

1. `production`: the production build of the app (`dev/compose.e2e.yaml`).
   Every test runs here unless it is tagged `@dev-server`.
2. `dev-server`: `next dev`, for tests tagged `@dev-server`. These tests need
   something that a production build turns off on purpose: the scripted AI
   model (`PLATFORM_AI_SCRIPTED`), screenshot downloads from the mock
   (`SCREENSHOT_E2E_ALLOWED_DOWNLOAD_HOSTS`), or room under Better Auth's
   production sign-in limit (3 per 10 s).

Tag a test `@dev-server` only for one of these reasons, and say which in a
comment when it is not the AI model. Each lane is a
Playwright project, so `npx playwright test --project=production` runs one
lane against a server that you started yourself.

## Write a spec

Every spec imports from one place, `./framework`, and declares the state it
starts from. The fixtures build that state through the API, wait for the
page, and clean up after the test.

```ts
import { db, expect, openWorkspaceSetting, test } from './framework'

// Every test in this file starts signed in to its own Pro workspace.
test.use({ workspaceOptions: { plan: 'pro' } })

test('an owner saves the workspace description', async ({ app, page, workspace }) => {
  await openWorkspaceSetting(page, 'General')
  const description = page.getByLabel('Description', { exact: true })
  await description.fill('Our launch team')
  await page.getByRole('button', { name: 'Save workspace' }).click()
  await expect(page.getByText('Workspace details updated.')).toBeVisible()
  await app.reload()
  await expect(description).toHaveValue('Our launch team')
  expect(
    await db.row('SELECT role FROM member WHERE "organizationId" = $1', [workspace.id])
  ).toMatchObject({ role: 'owner' })
})
```

Follow these rules:

1. Import `test`, `expect`, helpers and Playwright types only from
   `./framework`.
2. Declare the start state. Use one of these:
   - `test.use({ workspaceOptions })` when every test in the file starts in
     the same workspace.
   - `startWorkspace(options)` when the tests in a file need different
     channels or plans.
   - The `workspace` fixture when a test only needs the workspace id.
3. Do not sign up through the form. Only the specs that test sign-up and
   onboarding use the form.
4. Open pages with `app.open(path)` and reload with `app.reload()`. Both wait
   until React hydrates the page. Open the screenshot editor with
   `app.openEditor()` only when the test uses the editor.
5. Wait for a state, not for a time. Use web-first assertions and
   `expect.poll`. After you move the caret in a draft, call
   `settleSelection(page)`.
6. Query the database with `db`. Do not open or close a pool.
7. Keep a test under 60 seconds. Tag a longer journey
   `{ tag: '@journey' }` (five minutes). Only a test that needs more than
   five minutes sets `test.setTimeout`, with a comment that says why.
8. Give every new account, workspace and channel a unique name. Workers run
   at the same time, and a shared name causes failures.

In `test/e2e/*.spec.ts`, ESLint enforces rule 1 and bans `waitForTimeout`,
`networkidle` and `force: true`. A deliberate time window, for example to
prove that something does not happen, needs an `eslint-disable-next-line`
comment that says why.

## Fixtures

| Fixture                      | What it gives                                                              |
| ---------------------------- | -------------------------------------------------------------------------- |
| `identity`                   | A unique user for this test.                                               |
| `workspace`                  | The signed-in owner's workspace: `{ id, channels }`.                       |
| `workspaceOptions`           | The file's start state: `{ plan, channels, verifiedStandardVideo }`.       |
| `thirdPartyAssets`           | Set it for a file whose pages load fonts or models from a CDN (see below). |
| `startWorkspace(options)`    | Builds this test's workspace with its own options.                         |
| `app`                        | `open`, `reload`, `openEditor` and `expectPath`.                           |
| `page`, `browser`, `context` | The Playwright fixtures.                                                   |

A workspace with `channels` also gets two-factor authentication, the Go
backend binding, verified channel connections and a social API mock. The
framework removes the binding and stops the mock after the test.

## Parallel workers

Playwright runs 4 workers in CI. The framework isolates each test:

- Each test has its own user, workspace and client IP
  (`x-forwarded-for`), so rate limits count only the test's own requests. The
  browser also sends the IP to other origins, where it forces a CORS
  preflight that a CDN refuses. A file whose pages load fonts or models
  from a CDN sets `test.use({ thirdPartyAssets: true })`, which removes
  the header from those requests. It is off by default, because it turns
  off the browser cache and makes tests slower. Do not set
  `extraHTTPHeaders` in a spec: it replaces the client IP.
- Each worker has its own social API secret (`SOCIAL_API_KEY_E2E_W<n>`,
  8 slots, so at most 8 workers). The router on port 5679 sends each
  request to the mock of the worker that owns the secret. An OAuth callback
  has no token, so the router finds the worker from its OAuth state
  (`framework/social-mock.ts`).
- Each worker has one database pool, which `db` uses.

## Durations

CI writes `playwright-report/results.json` and adds a duration table to the
job summary. To make the table locally, run:

```sh
node scripts/e2e-durations.mjs playwright-report/results.json
```

Setup helpers record their time as `setup-ms` annotations, so the table
shows how much of each test is setup.

## Failures

The framework attaches the test email and workspace name to a failed test.
It never writes the test password to an artifact.

## Downstream boundaries

Use `mockBrowserJson` for a browser-originated third-party request. It returns
the configured JSON response and records calls for assertions. For server-side
egress and real dependency validation, follow
[`downstream-dependencies.md`](../../../../../.agents/skills/add-e2e-flow/references/downstream-dependencies.md).

- Run destructive dependency failure cases in `make e2e-recovery`, not in the
  parallel browser suite. It restores every service in a `finally` block.
