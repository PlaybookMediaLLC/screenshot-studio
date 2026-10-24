# Plan and Analyze — verification record

Audit date: October 24, 2026. Workspace: `/workspace/screenshot-studio`, branch `work`. No deployment, merge, or live-provider certification is implied. [Implementation](implementation.md) · [80 individual acceptance rows](implementation-matrix.md).

## Reproducible commands

Run JavaScript commands from the repository root and Go commands from `services`. Use a real Go installation (this environment required `/workspace/scratch/go/bin` first in PATH). Database URLs below are placeholders for disposable local services, not production credentials.

```bash
export PATH=/workspace/scratch/go/bin:$PATH
export PUBLISHING_TEST_DATABASE_URL='postgresql://USER:PASSWORD@HOST:PORT/NAME_test?sslmode=disable'

# U — calendar, timezone, analytics presentation, CSV and missing-series assertions
npx tsx --test test/plan-analyze.test.ts

# D — real PostgreSQL lifecycle, concurrency, permission, analytics and partial-publication assertions
cd services
go test -count=1 -json ./internal/product -run 'TestPlanAnalyzeDatabase|TestAnalyticsGoalPeriods|TestAnalyticsRetryClassification|TestWritePublishing' > ../.local/plan-analyze/domain-evidence.jsonl

# H — authenticated HTTP forwarding, validation and public no-store/service-auth contract
go test -json ./internal/httpapi

# G — all Go packages, serial package execution for shared database fixtures
go test -p 1 -json ./... > ../.local/plan-analyze/go-all-serial.jsonl

# G2 — final changed packages including provider error handling
go test -p 1 -json ./internal/product ./internal/httpapi ./internal/publishing ./internal/social/tenantpublishing ./internal/social/integrations/social/x ./internal/social/integrations/social/linkedinpage ./internal/social/integrations/social/linkedin ./internal/social/integrations/social/threads ./internal/social/integrations/social/instagram ./internal/social/integrations/social/facebook ./internal/temporalpublishing ./internal/temporalmaintenance > ../.local/plan-analyze/go-final-4.jsonl

# S — adapter/domain integration tests with disposable database creation and real local Temporal
SOCIAL_TEST_DATABASE_URL="$PUBLISHING_TEST_DATABASE_URL" SOCIAL_TEST_TEMPORAL_ADDRESS=127.0.0.1:7234 SOCIAL_TEST_TEMPORAL_NAMESPACE=shots-plan-analyze-test go test -p 2 -json ./internal/social/... > ../.local/plan-analyze/go-social-db.jsonl

# I — actual local object storage and Redis
MEDIA_TEST_ENDPOINT=http://127.0.0.1:9003 QUOTA_TEST_REDIS_URL=redis://127.0.0.1:63799/15 go test -json ./internal/media ./internal/quota > ../.local/plan-analyze/go-infra.jsonl
cd ..

# Q — repository checks
npm run api:generate
npm run build:sdk
npm run format:check
npm run lint -- --max-warnings=0
npm run typecheck
npm run test
npm run verify:rfcs
npm run build

# B — authenticated browser workflows and existing Write/Settings/social-set regressions
# Start Next, product-api, PostgreSQL, Redis, storage, Temporal and product-worker first.
# E2E_DATABASE_URL targets the disposable full local application database.
E2E_DATABASE_URL='postgresql://USER:PASSWORD@127.0.0.1:54329/screenshot_studio?sslmode=disable' E2E_REDIS_URL=redis://127.0.0.1:63799 E2E_BASE_URL=http://localhost:3000 E2E_COMPOSE_LOGS=false npx playwright test test/e2e/plan-analyze.spec.ts test/e2e/content-drafts-platform.spec.ts test/e2e/write.spec.ts test/e2e/settings-platform.spec.ts test/e2e/social-set-scope.spec.ts --reporter=json > .local/plan-analyze/browser-final.json
```

Focused browser reruns used the same B environment with these exact commands:

```bash
npx playwright test test/e2e/plan-analyze.spec.ts test/e2e/write.spec.ts test/e2e/settings-platform.spec.ts --grep 'Analyze acceptance|personal settings are|refine previews|the library organizes|draft text survives' --reporter=json > .local/plan-analyze/browser-recheck.json
npx playwright test test/e2e/write.spec.ts test/e2e/settings-platform.spec.ts --grep 'personal settings are|the library organizes' --reporter=json > .local/plan-analyze/browser-regression-last.json
npx playwright test test/e2e/plan-analyze.spec.ts test/e2e/write.spec.ts --grep 'Plan acceptance|the library organizes' --reporter=json > .local/plan-analyze/browser-flex-final.json
npx tsx --test test/plan-analyze.test.ts test/api-platform-boundary.test.ts test/web-database-boundary.test.ts test/openapi-contracts.test.ts > .local/plan-analyze/boundaries-final.log
```

The final S run used SOCIAL database/Temporal variables with PUBLISHING_TEST_DATABASE_URL unset; its eight publishing skips were already executed by G/G2. The command above can instead enable both. I additionally requires the local storage credentials already used by the application. Do not copy local secret files into evidence or source control.

## Actual results

| Run              | Observed result                                                                                                          | Evidence                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Boundary rerun   | 45 passed; 0 failed/skipped                                                                                              | `boundaries-final.log`                                                                                  |
| U                | 26 passed; 0 failed/skipped                                                                                              | `unit-2.log`; also included in final npm run                                                            |
| D                | 40 passed; 0 failed/skipped                                                                                              | `domain-evidence.jsonl`                                                                                 |
| G                | 1,768 passed; 164 skipped; 0 failed; 125 passing packages                                                                | `go-all-serial.jsonl`                                                                                   |
| G2               | 850 passed; 0 failed/skipped; 12 passing packages                                                                        | `go-final-4.jsonl`                                                                                      |
| S                | 1,063 passed; 9 skipped; 0 failed; 96 passing packages                                                                   | `go-social-db.jsonl`                                                                                    |
| I                | 5 passed; 0 failed/skipped                                                                                               | `go-infra.jsonl`                                                                                        |
| npm tests        | Root 1,038 passed; SDK 8 passed/1 optional integration skipped; Plate 21 passed. Total 1,067 passed, 1 skipped, 0 failed | `npm-test-final.log`                                                                                    |
| SDK/OpenAPI      | Passed generation/build                                                                                                  | `sdk-final.log`, `api-generate-final.log`                                                               |
| RFC checks       | 17/17 passed                                                                                                             | `rfcs-final.log`                                                                                        |
| TypeScript       | Passed full Next route type generation and `tsc --noEmit`                                                                | `typecheck-final.log`                                                                                   |
| Lint/format      | Passed with no ESLint errors/warnings; format check passed                                                               | `lint-final-2.log`, `format-check-final.log`                                                            |
| Production build | Passed optimized production build and route generation                                                                   | `build-final.log`                                                                                       |
| B                | 18 unique workflows passed across the full run and focused repairs (13 + 3 + 2); final Flex repeat 2/2 passed            | `browser-final.json`, `browser-recheck.json`, `browser-regression-last.json`, `browser-flex-final.json` |

Counts are emitted named test/subtest results, not a fabricated count of acceptance IDs. Go packages without test files are excluded from the named-test skip counts. Test commands overlap; do not add their totals to claim unique tests.

The successful production build emitted webpack warnings from Hugging Face background removal, MediaPipe redaction imports and circular runtime chunks. They did not block compilation, TypeScript or generation of all 1,139 static pages; the full warnings remain in `build-final.log`.

The final D run also reads persisted audit records: swap replay produces exactly one successful event per changed draft, and goal/enable/revoke produce exactly three authorized settings events. Denied and stale operations add no success events; sharing tokens are absent from audit metadata.

G's skips were 140 social DB/Temporal-dependent tests (subsequently exercised by S), three media/Redis tests (subsequently exercised by I), ten unrelated opt-in maintenance DB tests, nine unrelated migration/upgrade fixtures requiring fresh databases, one browser fixture worker and one opt-in live public metadata test. S's remaining nine skips are eight publishing tests exercised in G/G2 plus that intentionally opt-in live metadata test. Full migrations were applied locally; the unrelated upgrade-fixture skips are disclosed, not labeled passed.

The first concurrent `go test ./...` encountered cross-package fixture deadlocks in the shared test database. Serial package execution passed. This is why G specifies `-p 1`.

## Browser evidence and repaired failures

The Plan acceptance test uses real authentication, two same-named X/LinkedIn sets in New York/Tokyo, scoped tags and PostgreSQL assertions. It covers visibility, source browsing, exact slots, views/resizing, keyboard/mobile, creation, no-job planning, scheduling/unscheduling, drag/swap/Undo, stale mutations, display-zone invariance and published-content reuse with an intentionally lost response.

The Analyze acceptance test seeds explicitly labeled historical provider fixtures, then exercises real report APIs, rapid account changes, skeleton accessibility, malformed/missing metrics, zero series, ranges/grouping, all hourly modes, exact post drilldown, goals, sorted pagination, downloaded CSV, chart-image controls/PNG and public enable/revoke from a new unauthenticated browser context. It asserts no unhandled browser page errors. Intentional network errors are part of the recovery tests.

Initial browser verification found and repaired Date-wire parsing, account/metric request races, a clipped Analyze scroll container, and incomplete export/slot checks. The broader first regression run passed 11 workflows and failed seven: two obsolete Settings labels; two obsolete calendar selectors/contracts; duplicate/reuse runtime query failures in two workflows; and a publication-failure workflow run without its worker. The reruns use restarted API/web, updated selectors, current contracts and the local product worker. The Flex loading/error banner also exposed a height-boundary feedback loop: changing the measured viewport changed the range, causing another load and detaching cards. A fixed-height status area removes the loop; the existing Write-to-Plan card interaction verifies it. An additional old Settings assertion omitted its now-explicit Save time zone action, and the old Write retry test assumed transport failures were always definitive failures. It now verifies that unknown outcomes cannot be retried until explicitly reconciled. A pagination assertion was corrected to compare the same DOM text representation. Its outbound provider proxy points to a closed local port, preventing any real external publication; fixture failure/retry is not a live-provider success claim.

Screenshots and generated image: `.local/plan-analyze/plan-desktop.png`, `plan-mobile.png`, `analyze-desktop.png`, `analyze-mobile.png`, `chart-image.png`. Browser traces are generated under ignored `test-results` on failures. Evidence logs remain local/ignored because they contain fixture identities and operational details. The matrix records durable summaries and exact executable cases.

## Develop integration verification

Work PR [#305](https://github.com/PlaybookMediaLLC/screenshot-studio/pull/305) targets `develop`. The implementation was rebased onto the RFC renumbering and branch policy, then updated with the latest capture-design documentation. Ent and OpenAPI regeneration produced no drift. After this integration, `COLLAB_TEST_REDIS_URL=redis://127.0.0.1:63799 npm run quality:check` passed: 1,080 JavaScript tests with no skips/failures, TypeScript, lint, formatting and 18/18 RFC checks. The six changed backend domain/HTTP/publishing/Temporal packages passed 545 tests; `go vet ./...` passed.

The first PR CI run found an incompatible newly required `baseCalendarVersion` on the existing Plan endpoint. Its request shape now keeps that field optional, while the Go service permits omission only for an untouched, unplanned draft at revision 1. Existing and migrated plans cannot be overwritten or cleared without an explicit revision. This preserves the initial legacy request and the concurrency guard. The fix passed 41 domain tests and 38 unit/OpenAPI tests, with no failures or skips:

```bash
npx tsx --test test/plan-analyze.test.ts test/openapi-contracts.test.ts
# In services, using the D database environment:
go test -count=1 -json ./internal/product -run 'TestPlanAnalyzeDatabase|TestAnalyticsGoalPeriods|TestAnalyticsRetryClassification|TestWritePublishing'
# From the root, using the fetched develop base:
git show origin/develop:services/internal/shotsapi/openapi.json > .local/plan-analyze/base-openapi.json
go run github.com/oasdiff/oasdiff@v1.33.0 breaking .local/plan-analyze/base-openapi.json services/internal/shotsapi/openapi.json --fail-on ERR --format githubactions --err-ignore services/internal/shotsapi/breaking-changes-allowed.txt
```

The exact CI compatibility check above passed without adding an exception. Local evidence is in `quality-develop.log`, `go-develop.jsonl`, `vet-develop.log`, `domain-compat.jsonl`, `compat-unit.log` and `openapi-compat.log`. The PR records subsequent GitHub build/check results; the earlier counts above remain the original implementation audit.

The SDK forwarding types were also updated for the optional legacy revision; `npm run build:sdk`, `npm run typecheck` and a fresh `npm run build` passed (`sdk-compat.log`, `typecheck-compat.log`, `build-compat.log`). Automated PR review then identified receipts retained by workspace deletion because the organization tombstone survives. `TestWorkspaceCleanupRemovesPlanAnalyzeDataAndKeepsOtherTenants` reproduced that leak before the fix. Explicit tenant-scoped deletion of receipts and analytics records now passes; the test also checks the surviving tenant, tombstone, audit event and repeated cleanup. The full maintenance suite passed 17 tests, none skipped, with the race detector:

```bash
# From services, against a separate disposable, fully migrated database:
MAINTENANCE_TEST_DATABASE_URL='postgresql://USER:PASSWORD@HOST:PORT/maintenance_test?sslmode=disable' go test -race -count=1 -json ./internal/maintenance
```

Evidence: `purge-before.log`, `purge-after.jsonl`, `maintenance-migrate.log`. This also exercises the maintenance database cases skipped in the earlier G run.

A second review found that a deleted post's 30-day backoff also delayed its entire account. The database regression reproduces both HTTP 404 and 410 before the fix (`deleted-post-before.log`). Collection now preserves the account's 45-minute interval and available status, continues healthy post metrics and follower observations, imports new publications on the next pass, and stops polling the deleted post. The D command with `-race` passed 44 named tests with no failures or skips (`deleted-post-after.jsonl`); `go vet ./internal/product` passed. CI also runs `test/e2e/plan-analyze.spec.ts` independently of the three full-suite browser shards, so these acceptance flows receive a result even when unrelated browser regressions exhaust a shard's time budget.

Week cards now use separate lanes for overlapping time ranges, including repeated DST hours. The 29 Plan/Analyze unit tests passed, as did typechecking, focused ESLint, and the full authenticated Plan acceptance workflow with a new same-instant, two-account assertion that opens each card by pointer (`week-overlap-unit.log`, `week-overlap-typecheck.log`, `week-overlap-browser.json`). The browser fixture's destination is explicitly selected. CI's npm comparison also required bumping the changed backend SDK from the published `0.1.40` to `0.1.41`; its build and subsequent SDK CI check passed.

Archive restoration now restores visibility while retaining the scheduled state of active, uncertain, published or partially published commitments. It preserves provider records and calendar revisions, creates no publishing jobs, and continues to reject actual planning of committed content. The regression reproduced the restore rejection before the fix (`restore-before.log`); D with `-race` then passed 53 tests with no failures or skips (`restore-after.jsonl`), including eight restoration states, stale updates and attempts to combine restoration with replanning. `go vet ./internal/product` passed. Restore notifications no longer imply published content became a new draft.

## External checks before production enablement

- Use authorized provider accounts, actual granted scopes, supported API tiers and quota. X follower reads, timeline import and private click metrics require the corresponding provider access; unavailable private counters remain absent. LinkedIn personal currently lacks the installed analytics interface; do not infer support from publishing. Page/Instagram/Threads permissions are provider-specific.
- Execute a live approved publication, confirm its exact provider receipt, and observe a later worker ingestion/report. The local tests use provider fixtures and a real repository/Temporal path; they do not satisfy this external certification.
- Verify the deployed existing maintenance worker, due-account backlog, rate limits and freshness at production volume. Public sharing remains default-off and only changes by an explicit authorized action.
- Review lifetime/partial-counter and incomplete-history definitions with report consumers. There is no claim of event-time engagement, guaranteed best posting time, full historical import or matched-age performance.

The Docker Go builder encountered the environment proxy's untrusted certificate; host Go binaries were used instead. The bundled Temporal container was replaced by a healthy local Temporal dev server. These local infrastructure workarounds did not disable application authentication, tenant checks or provider verification.
