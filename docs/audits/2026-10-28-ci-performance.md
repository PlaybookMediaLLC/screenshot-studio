# CI and E2E performance audit — 2026-10-28

## Scope and evidence

Audited all 1,149 workflow runs returned for October 21–28 (UTC), through 20:10 UTC on October 28, and every job and step in each run’s latest attempt. Queries were split by day to avoid GitHub’s 1,000-result search limit. All 11 workflows currently in `.github/workflows/` were reviewed. The two Dependabot-generated workflows were included. Kind has no recorded runs; the retired Bootstrap App Platform image workflow last succeeded on October 13 and is outside the timing window.

The table uses successful runs only for wall-time percentiles, measured from the first executing job to the last completed job. It excludes queue delay, skipped jobs and canceled runs. Summed job time is an estimate of runner occupancy, not billed cost; it excludes earlier attempts and any currently running job. Workflow changes during the week mean this is an audit baseline, not a controlled benchmark of today’s checkout.

| Workflow | Runs | Success / failure / canceled | Successful median / p90 | Summed job minutes |
|---|---:|---|---|---:|
| Branch policy | 115 | 94 / 16 / 0 | 0.1 / 0.1 min | 7 |
| CI | 352 | 10 / 74 / 190 | 35.8 / 44.2 min | 19014 |
| Commitlint | 205 | 152 / 47 / 1 | 1.1 / 1.4 min | 189 |
| Dependabot Updates | 2 | 2 / 0 / 0 | 1.4 / 2.0 min | 3 |
| Dependency Graph | 4 | 4 / 0 / 0 | 0.9 / 1.1 min | 3 |
| Helm chart | 20 | 18 / 2 / 0 | 0.2 / 0.2 min | 3 |
| IndexNow | 222 | 32 / 11 / 23 | 0.3 / 0.4 min | 13 |
| Publish SDK | 66 | 38 / 28 / 0 | 0.3 / 0.7 min | 19 |
| Release Please | 90 | 77 / 11 / 2 | 0.4 / 0.7 min | 36 |
| Social backend image | 19 | 13 / 5 / 1 | 9.0 / 15.5 min | 116 |
| Sync Upstream | 8 | 0 / 8 / 0 | No successful run | 2 |
| Web image | 46 | 31 / 7 / 8 | 15.2 / 22.1 min | 550 |

Other run conclusions (skipped, awaiting approval, in progress) are not classified as failures. The companion JSON preserves their counts.

## Why it takes so long

1. **The same production web image is compiled in validation and every browser shard.** Run [40750650255](https://github.com/PlaybookMediaLLC/shots/actions/runs/40750650255) spent 672 seconds building it in validation and another 592, 610 and 723 seconds in its three shards: 43.3 summed runner minutes for the same application. Current HEAD had moved shard builds into background processes, but still repeated the work, without persisted layer caching in those builds. The PID polling loop also had no build exit status; only a final image-existence check.

2. **Stack setup is expensive before tests start.** The same run spent 368–403 seconds per shard starting the local stack. In smoke run [40754872991](https://github.com/PlaybookMediaLLC/shots/actions/runs/40754872991), startup took 393 seconds and a serial web build took 573 seconds; browser execution took only 134 seconds. Compose builds the Go service and a separate dev web image; host npm installation and Docker npm installation are separate. `up` installs dependencies into the dev volume even though the dev image already contains them. This remains a follow-up target; host and Linux container modules must not be mixed.

3. **There are real long-running journeys and uneven shards.** The three production reports in run 40750650255 took 678, 553 and 401 seconds. The motion MP4 export alone took 489.6 seconds; two creative-set journeys took 192.2 and 158.9 seconds. Sharding is by file/test count, not duration. The dev lane added 292–337 seconds per shard with multiple retries. Those measurements precede the current single-worker dev-lane fix; they do not prove that the same failures remain today. No tests, retries, assertions or budgets were removed.

4. **Canceled work dominates runner use.** 190 of 352 CI runs were canceled. They account for approximately 13,226 of 19,014 summed CI job minutes (70%) in the latest attempts. Existing concurrency cancellation is valuable and remains enabled. Shorter builds reduce wasted work before a replacement run; changing merge cadence or skipping gates would require a separate policy decision.

5. **Validation serialized independent work.** Client checks took 243–268 seconds and then waited through a 674–701 second image build in the sampled successful runs. They can start together while retaining the required `CI validation` check.

6. **Deployment time has separate causes.** In [web run 40707415180](https://github.com/PlaybookMediaLLC/shots/actions/runs/40707415180), building/pushing took 552 seconds, the backend-order wait took 62 seconds, and web deployment took 188 seconds. Backend deployment [40707415184](https://github.com/PlaybookMediaLLC/shots/actions/runs/40707415184) spent 228 seconds building/pushing and 146 seconds cutting over. Migration ordering, the shared deployment lock, immutable image references and health verification remain necessary.

The implementation follows Docker’s [image sharing](https://docs.docker.com/build/ci/github-actions/share-image-jobs/) and [cache scope](https://docs.docker.com/build/cache/backends/gha/) guidance. Playwright documents [file-level sharding](https://playwright.dev/docs/test-sharding#balancing-shards), which explains why equal test counts do not guarantee equal elapsed time.

## Changes in this branch

- Build and smoke-test one web image per workflow run, alongside client checks and stack setup. Shards load its compressed artifact rather than compiling it again. Artifacts are restricted to the same run and exact SHA. A failed-job rerun can reuse a successful earlier attempt. Missing/expired artifacts and failed producers fail closed, with a bounded wait. The required `CI validation` check aggregates both quality and image results.
- Use explicit, existing release cache scopes for CI web and backend builds. Limit the web build’s source copy to `clients/` and the shared media-limits JSON, so changes to `dev/`, infra and release scripts no longer invalidate its application layer.
- Let Compose recreate services when their configuration changes between E2E lanes. Stop forcing unchanged backend and worker containers to restart; application lane changes still replace the app. The plain-Node screenshot mock is recreated separately so local source edits always take effect.
- Fix E2E duration reporting to include setup from every attempt, preserve flaky outcomes, rank by total time including retries, and show report wall time and retry overhead.

A full three-shard run goes from four production-web compilations to one. This removes three copies of an observed 10–12-minute build; elapsed-time savings depend on cache hits, artifact transfer and runner queueing. No hosted speedup is claimed until the revised workflow runs.

## Other workflows and failures

- Branch policy, Commitlint, Helm, IndexNow, SDK release checks and Release Please are mostly short. Keep their policy and authorization checks. Commitlint still installs the full workspace; a separate locked tooling workspace could reduce that cost but adds dependency maintenance and is not introduced here.
- SDK publication [40588903355](https://github.com/PlaybookMediaLLC/shots/actions/runs/40588903355) failed at `npm publish` with npm E404 for `screenshot-studio-backend-sdk@0.1.41`. This is publication/authentication evidence, not a build-speed diagnosis; the audit does not alter npm trust or credentials.
- All eight upstream sync runs failed. Latest [40710246161](https://github.com/PlaybookMediaLLC/shots/actions/runs/40710246161) reached upstream merge conflicts (and had an earlier checkout DNS failure). Resolve the upstream branch as a separate change; speeding the runner cannot resolve content conflicts.
- Live branch-policy audit: `GET /repos/PlaybookMediaLLC/shots/rules/branches/develop` returned no required-status-check rules; classic `branches/develop/protection/required_status_checks` returned HTTP 404 “Branch not protected.” The `CI validation` check name and its failure behavior are preserved here, but enforcement is not configured on develop at this observation. No repository protection settings were changed.
- Kind is manual and has no run history to benchmark. Its 20-minute budget includes image builds and the browser suite, so it needs a measured parity run before treating that budget as sufficient.
- Bootstrap App Platform image is absent from the current checkout; its October 13 run succeeded. No active pipeline depends on it here.

## Follow-up measurements

Compare the next successful smoke and full-suite runs with the linked baselines. Record build cache hits, export/upload/download/load time, stack startup, per-lane wall time, retry overhead and total job minutes. Confirm every shard uses the same image and all existing gates still run. Then prioritize reusable Linux dev/backend build layers and duration-balanced shards; increasing worker count before addressing the dev-server contention is not supported by the evidence.

## Validation

Final verdict: **Ship for CI validation**. No blocking source-review findings remain; hosted performance and the complete browser suites are not yet verified.

- `npm run quality:check`: passed (format, lint with zero warnings allowed, workspace typechecks, 1,178 passing tests; one Redis-dependent test initially skipped without its endpoint). The collaboration suite was then rerun with a real isolated Redis: 10/10 passed.
- Focused artifact-wait, duration-report, stack-readiness and manifest tests: 20 passed. Cases cover exact SHA/run isolation, prior attempts, expired artifacts, failed/canceled/skipped producers, missing producer timeout, the upload-completion race, API errors, and the actual lane-start function’s mock/backend lifecycle.
- `actionlint .github/workflows/ci.yml`, `bash -n dev/studio`, and `git diff --check`: passed. No Gauntlet command is configured in this repository.
- Web and backend Docker builds: passed. The web image served `/api/health` and the exact committed IndexNow file. Its compressed save/load round-trip passed (401 MiB archive on this machine).
- Isolated Compose project, production image: 38 smoke executions passed in 1.1 minutes (`--workers=4 --repeat-each=2`). The first run failed because the separate project's mock port and storage CORS still used the original ports; corrected only the temporary test configuration and reran the same selection successfully.
- Repeated Compose startup retained the backend and worker container IDs, confirming unchanged services are reused.

Hosted execution requires publishing this branch; no workflow was dispatched or deployment changed during the audit. Full production/dev/recovery suites and hosted artifact permissions, transfer time and cache-hit behavior still need a revised CI run. The smoke run is not evidence that the full suite passes.

## Review team

Five required lenses ran: structure, performance, failure modes, QA and lean design. No extra stack specialist was added for this CI/configuration change. Two verified blocking findings were fixed: an upload completing between the artifact and job queries could fail a consumer, and retaining the plain-Node mock could serve old source on later local runs. Regression tests now cover both. Both reviewers independently rechecked the fixes and confirmed their blockers resolved. Final full quality gate passed with Redis enabled: 1,181 tests passed, zero failed or skipped.

Nonblocking follow-ups were left unchanged: gate image export/upload when the browser plan is disabled (main pushes and docs-only PRs currently upload an unused artifact); omit unused backend image loading/tagging in its build-only validation step. Lean review identified two removable lines. No test gates or assertions were weakened.
