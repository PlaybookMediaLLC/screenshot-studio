# RFC 036: Store Provider End-to-End Verification

**Status:** Accepted  
**Date:** 2026-10-17  
**Decided:** 2026-10-17 (see Decisions)  
**Owners:** Engineering  
**Depends on:** [Store screenshot studio](../store-screenshots.md), RFC 020 ([publishing gate precedent](020-postiz-publishing.md)), `lib/integrations/google-play.ts`, `lib/integrations/app-store-connect.ts`, `lib/integrations/figma.ts`, `lib/ai/models/provider.ts`

## Decision

Verify the store studio's external flows (Google Play uploads, App Store
Connect uploads, Figma import, and AI translation and copy) at two levels:

1. **Fake providers on every pull request.** A local server speaks each
   provider's HTTP API from recorded fixtures. The browser suite drives the
   real UI against it. This catches regressions in our code, deterministically
   and for free.
2. **Live providers nightly and on demand.** A gated workflow runs the same
   browser flows against dedicated test accounts at Google, Apple, Figma, and
   OpenRouter. It never commits a Play edit, never submits an App Store
   version, and cleans up everything it uploads. This catches the provider
   changing under us, which fakes cannot.

The live gate is the only evidence that "the integration works". Until it has
run green, the completion matrix in PR #138 keeps F05, F13, F14, F22 (Figma),
and Workflow F at their current statuses.

## Why two levels

Today the integrations are covered by contract tests that inject `fetch`
(`tests/store-publishing-integrations.test.ts`) and by the scripted model
(`lib/ai/models/scripted.ts`). Neither runs the browser flow, and neither
talks to a real provider:

- The scripted model bypasses the OpenRouter HTTP layer entirely, so a broken
  provider setting, model id, or tool schema would pass every test.
- The store clients are tested function by function. The UI that sequences
  them (pick app, pick version, upload per size and language, commit) has no
  automated coverage beyond rendering.
- Apple, Google, and Figma change response shapes, quotas, and processing
  behavior without notice. Only a live run notices.

Live runs alone are not enough either: they need secrets that fork PRs must
never see, they cost money, and they fail for reasons outside our control. A
pull request has to be judged on deterministic fakes; the live gate reports on
the providers.

## Level 1: fake providers on every pull request

### Base URL overrides

Each client gets a server-only base URL setting, read once at startup:

| Setting | Default | Used by |
| --- | --- | --- |
| `GOOGLE_PLAY_API_URL` | `https://androidpublisher.googleapis.com` | Edits, images, validate, commit |
| `GOOGLE_OAUTH_TOKEN_URL` | The service account's `token_uri` | Service-account token exchange |
| `APP_STORE_CONNECT_API_URL` | `https://api.appstoreconnect.apple.com` | Apps, versions, screenshot sets, uploads |
| `FIGMA_API_URL` | `https://api.figma.com` | Files and image renders |
| `OPENROUTER_BASE_URL` | OpenRouter's default | Every language model call |

Rules:

- An override is accepted only when `NODE_ENV` is not `production`. In
  production the setting is ignored and logged once at startup, so a
  misconfigured environment cannot redirect real credentials to another host.
- The Figma image download keeps its host allow-list. The override adds the
  fake's host to the list only when the override is active.
- The Play OAuth token URL in a service-account file is ignored when the
  override is set, so fixture key files can use real-looking contents.

The clients already accept an injected `fetch`, so this changes where the
default URLs come from, not how requests are built.

### The fake

`e2e/fixtures/fake-stores.mjs`, modeled on `e2e/fixtures/fake-social.mjs`,
runs as a Compose service under the `e2e` profile. It implements just enough
of each API for the studio's flows, backed by in-memory state per run:

| Provider | Endpoints | Behavior worth faking |
| --- | --- | --- |
| Google Play | OAuth token, edits insert/validate/commit/delete, images list/upload/deleteall | Edit expiry, 8 MB limit, per-language image counts, 429 with `Retry-After` once |
| App Store Connect | apps, appStoreVersions, localizations, appScreenshotSets, appScreenshots reservation, upload operations, commit | Upload operations split into parts, asset state moving from `UPLOAD_COMPLETE` to `COMPLETE`, a 409 on a duplicate reservation |
| Figma | files (depth 2), images, image CDN | Frames on several pages, a render URL that is valid once |
| OpenRouter | chat completions with tool calls | Returns the submit tool call from the scripted model's logic, plus `usage.cost` |

The fake verifies the credentials it receives: a JWT signed with the fixture
App Store Connect key, an OAuth assertion from the fixture service account,
and the fixture Figma token. A client that sends the wrong auth fails here,
not in production.

The OpenRouter fake reuses the scripted model's response builders, so
translation and copy output stay deterministic. The difference from today is
that requests now travel through `@openrouter/ai-sdk-provider` over HTTP, so
model ids, tool schemas, and usage accounting are exercised.

### Specs

New flows in `e2e/store-providers.spec.ts`, run by `make e2e` and CI:

1. **Google Play**: add a connection with the fixture service account, upload
   two sizes in two languages to a draft edit, check the commit button stays
   disabled until the confirmation box is ticked, commit, and assert the fake
   received the commit exactly once.
2. **Google Play failure**: the fake fails the third upload; the dialog
   reports it and does not offer a commit, and starting a new draft works.
3. **App Store Connect**: add a key, browse app → version → localizations,
   upload with "replace" on, and assert the fake's set holds exactly the new
   screenshots in slide order. Nothing calls a submission endpoint.
4. **Figma**: paste a file link and token, list frames, import two frames as
   slides, and check the imported asset dimensions.
5. **AI translation and copy**: translate to German and Arabic through the
   OpenRouter fake, approve one string, change the source, and see it marked
   outdated; generate headlines and apply one; check that AI credits were
   charged with the reported cost.

Credentials in these specs are fixtures generated for the test run, never real
keys.

## Level 2: live providers

### Accounts

| Provider | Test account | Credential | Blast radius |
| --- | --- | --- | --- |
| Google Play | A dedicated app (`com.playbookmedia.shots.e2e`) in our Play Console, with one internal-testing build uploaded by hand (the API cannot create an app) | Service account invited with store presence permission for that app only | That app's store listing drafts |
| App Store Connect | A dedicated test app record with version 1.0 in Prepare for Submission, in our existing developer team | A dedicated API key with the App Manager role, used only by this gate | Apple keys are team-wide, so the gate pins the test app (see Safety rules) |
| Figma | A test file with known frames in our own Figma test account | Personal access token with the file_content:read scope, 90-day expiry | Read access to that account's files |
| OpenRouter | A separate account | API key with a $20 monthly spend cap | The cap |

### Secrets and where the gate runs

- Secrets live in Infisical and sync to a GitHub environment named
  `provider-e2e`. Scheduled runs use it directly; manual runs require an
  approving reviewer.
- The workflow never runs on pull requests, so fork code never sees the
  secrets.
- A provider whose secrets are missing is reported as **skipped**, not passed,
  so a half-configured gate cannot look green.
- `bin/provider-gate` follows `bin/social-gate`: an isolated Compose project
  with its own database and volumes, torn down with `--volumes` on exit, and
  logs redacted the same way.

### What each live run does

| Provider | Flow through the UI | Out-of-band check | Cleanup |
| --- | --- | --- | --- |
| Google Play | Upload phone screenshots for one language into a new edit | Read the edit's images; compare SHA-256 to the exported files; call validate | Delete the edit. Never commit |
| App Store Connect | Upload one size to a dedicated localization with replace on | Poll until each screenshot is `COMPLETE`; compare checksums and order | Delete the uploaded screenshots and confirm the set is empty |
| Figma | Import every frame of the test file | Compare frame names and pixel sizes to a checked-in manifest | None (read only) |
| OpenRouter | Translate the sample set to `de-DE`, `ja`, and `ar`; generate headlines from a fixed brief | Structural assertions (below) | None |

AI output changes between runs, so live AI assertions are structural, not
exact:

- Every requested id comes back, and the numbered rich-text tags are balanced
  and in their source order.
- The output differs from the source, and uses the expected script (CJK for
  Japanese, Arabic letters for Arabic).
- Copy suggestions contain no digits absent from the brief and respect the
  headline length limit.
- The credit meter recorded a charge greater than zero for each call.

### Safety rules

1. The live gate never commits a Play edit and never calls an App Store
   submission endpoint. The fake level tests commit; the live level does not.
   A unit test asserts the live spec file contains no commit or submit step.
2. Playwright tracing, video, and screenshots are off for steps that handle
   credentials, and live runs upload no Playwright artifacts. A trace records
   request bodies, and the credential form posts the private key.
3. Connections are created through the UI once per run in the isolated
   database and deleted at the end, so stored ciphertext never outlives the
   run.
4. Cleanup runs in a `finally` block. A cleanup failure fails the run and
   names what was left behind.
5. The App Store Connect key can reach every app in our team, so the gate
   pins the test app: before any upload, the live spec checks that the chosen
   app id and bundle id match the configured test app and aborts otherwise.
   The key is created for this gate alone, so revoking it affects nothing
   else.

## Rollout

| Phase | Work | Gate |
| --- | --- | --- |
| 0 | Create the Play test app and its first build, the App Store test app record and a dedicated key in our team, and the Figma test file; load secrets into Infisical and the `provider-e2e` environment | Engineering confirms each account and its blast radius |
| 1 | Base URL overrides with the production guard; `fake-stores.mjs`; the five Level 1 specs in CI | Specs pass in CI and fail when a client's auth or request shape is broken on purpose |
| 2 | `bin/provider-gate` and a nightly plus manual workflow | Three consecutive green nightly runs per configured provider |
| 3 | Show the last live result per provider in the release PR, with a warning for a red or stale provider. It does not block the release | One release cycle |

## Cost

- Fakes: none beyond CI minutes.
- OpenRouter: one nightly run is about 70 short strings plus four headline
  calls, a few cents. The $20 cap bounds mistakes.
- Apple: none; the test app lives in our existing developer team.
- Google Play: no extra cost for a test app in the existing account.
- CI: about 15 minutes nightly on one runner.

## Observability

Each live run writes a job summary with one row per provider: status (passed,
failed, skipped), duration, uploaded file count, and AI cost. Failures and
stale results notify the engineering channel.

**The metric that actually matters is days since the last green live run, per
provider.** A provider more than two days stale gets a warning in the release
PR and the engineering channel until a green run clears it. It does not block
releases. Pass rate
and duration are secondary; they help separate a flaky provider from a broken
integration.

## Acceptance criteria

1. With the overrides unset, every client calls the provider's real host; with
   `NODE_ENV=production`, setting an override has no effect and logs a warning.
2. The five Level 1 specs pass in CI on every pull request without network
   access to Google, Apple, Figma, or OpenRouter.
3. Breaking a client's authentication or request shape on purpose makes the
   matching Level 1 spec fail.
4. A nightly live run uploads to Google Play and App Store Connect, verifies
   the files out of band, and leaves no edit, screenshot, or stored credential
   behind.
5. The live gate reports a provider without secrets as skipped, and the job
   summary shows status, duration, and cost per provider.
6. No live run commits a Play edit or submits an App Store version; a test
   enforces that the live spec contains no such step.
7. Live runs publish no Playwright traces or screenshots, and their logs
   contain no key material.
8. Each provider records three consecutive green nightly runs before Workflow
   F and F05 move to Complete in the completion matrix.

## Decisions

Recorded 2026-10-17:

1. **Apple account:** use our existing developer team, not a separate paid
   team. The gate pins the test app and uses a key created only for it
   (Safety rule 5).
2. **Ownership:** we own the test accounts, including the Figma test account,
   and Engineering rotates the Figma token every 90 days.
3. **Stale or red providers warn and do not block releases** (Phase 3).
