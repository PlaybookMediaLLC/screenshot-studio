# GitHub release automation

Workspace settings → **Release automation** connects the existing GitHub App,
watches repositories, and authors versioned workflows. This implementation uses
the Go product backend, Ent/Postgres, the tenant outbox, and one Temporal
interpreter. Browser state is never execution authority.

## Customer flow

1. An owner or administrator connects an accessible GitHub installation and
   chooses repositories. One installation may serve several workspaces.
2. Create a definition for one independent event family: published release,
   merged pull request, or successful deployment. Set qualification and priority.
3. Edit the graph with the canvas or labeled node/connection controls. Save an
   incomplete draft to retain work; validation errors block activation.
4. Test an example or a recorded event from this workspace. Preview uses the same
   Go validator and evaluator and performs no enrichment, generation, or writes.
5. Activate a saved revision. A compatible worker must have a current capability
   lease. New events pin immutable versions and their priority ordering.
6. Inspect the event history, selected definition, node decisions, attempts, and
   links to the resulting release and campaign drafts.

The editor opens a full-window canvas with a side inspector. **Node** edits the
selected step and its connections; **Workflow** sets qualification, priority,
and description; **Test** selects evidence and shows each predicted step. Click
a preview step to inspect its node. True and false branches have distinct labels
and colors, and a preview highlights the path it would take.

Save, Test, and Activate stay visible while the inspector scrolls. Press Enter
to select a focused canvas node, then use arrow keys to move it. Connection
selectors also support keyboard editing. Closing with unsaved changes asks
whether to keep editing or discard them; leaving the page also warns you.

Saving edits, including priority and layout, does not change active execution.
Concurrent saves/activations use revision checks; refresh after a conflict.
Lower active priority wins; definition ID breaks ties. The first matching
definition wins for a source and event family. An unresolved earlier definition
stops evaluation instead of granting a later definition permission to act.

The initial actions are **create release**, **create campaign drafts**, and
**submit for human review**. Campaigns use the source text, selected brand and
brand version, workspace audience, configured destination platforms, and CTA.
The brief records brand/context and destination references. This does not run
paid AI generation or rendering. Human editors can refine the drafts through
the existing campaign flow. Destination account selection and scheduling remain
in that human flow; this feature does not create a schedule.

**Submit for review ends execution.** There is no automatic approval, approval
wait/resume, autonomous publishing, or scheduling action. A successful run means
the chosen draft/review operations completed, not that content was published.
RFC 030 policies and RFC 031 autonomy remain proposals.

## Modes and compatibility

Unconfigured sources retain legacy behavior: merged PRs become collected
changes, published releases are ingested, and successful production deployments
retain the existing capture pipeline. Existing source branch, author, bot, and
prerelease filters apply before any definition.

Activating a definition puts its source in **automation mode**. Disabling every
definition leaves that mode enabled: it never silently resumes legacy release
creation. An administrator can explicitly select legacy intake. Mode changes
cancel previously admitted work. Automation mode has a separate, explicit policy
to collect or skip unmatched merged PRs. Accepted events retain that policy.
Production deployment capture is preserved even when no definition matches.

Disabling a definition, stopping repository watching, disconnecting a workspace
installation link, or receiving suspension/deletion/repository-removal events
requests cancellation. Every mutating activity checks workspace eligibility,
source mode, installation/link access, definition authorization, entitlements,
and referenced resource ownership again. GitHub repository access is checked
before graph actions. Work already in flight may finish; cancellation preserves
its outputs. Reconnecting/re-enabling never restarts cancelled runs.

Connections show unconfigured deployment, no connection, requested organization
approval, connected, suspended, deleted/disconnected, and removed repository
access. GitHub errors surface as attention states with recovery links. Stopping
watching or disconnecting one workspace never uninstalls the shared App.

## Event and graph contracts

`services/internal/releaseautomation` owns schema version 1. The SDK and Zod
contracts mirror the transport; the Go validator authorizes execution.

| GitHub event        | Accepted operation             | Semantic identity                                    |
| ------------------- | ------------------------------ | ---------------------------------------------------- |
| `release`           | `action=published`             | `release:<repository-id>:<release-id>`               |
| `pull_request`      | `action=closed`, `merged=true` | `pr:<repository-id>:<pr-number>`                     |
| `deployment_status` | `state=success`                | `deployment:<repository-id>:<deployment-id>:success` |

Release edits, unmerged closures, failed deployments, pushes, and tag pushes do
not execute this feature. A release tag condition is not a tag-push subscription.
`target_commitish` is not exposed as a branch. Deployment commit identity and
provider object IDs remain in the event snapshot and release lineage.

A graph has one trigger, typed conditions, registered actions, and explicit end
nodes. It is sequential, acyclic, reachable, and bounded to 64 nodes, 128 edges,
32 KiB, condition depth 8, and 128 predicates per condition. Branch merges require
input-producing actions to dominate the consumer on every incoming path.
Layout is stored separately from the semantic graph/hash. Incomplete drafts can
be stored, but they cannot exceed hard size/depth limits.

| Condition                  | Semantics                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `ALL`, `ANY`, `NOT`        | Nested groups; NOT has exactly one child. Unresolved evidence propagates through all groups.                 |
| `eq`, `ne`, `in`, `not_in` | Exact, case-sensitive strings; membership takes up to 50 values.                                             |
| `contains`, `not_contains` | Substring for a scalar; exact item membership for a collection.                                              |
| `starts_with`              | Case-sensitive prefix, including on collection items.                                                        |
| `glob`                     | Go `path.Match`: `*`, `?`, `[ranges]`, escaping; wildcards do not cross `/`. No `**` or regular expressions. |
| `exists`, `not_exists`     | Observed empty strings/lists exist. A missing field can be tested explicitly.                                |
| `is_true`, `is_false`      | Boolean fields only.                                                                                         |

Positive collection predicates match any item. Negative predicates require all
items to fail the positive predicate, so an observed empty collection satisfies
the negative predicate. Empty strings are values, not missing evidence.

Evidence states are `available`, `missing`, `not_applicable`, `pending`, and
`unavailable`; invalid conditions are distinct. Except explicit existence tests,
unresolved evidence cannot select the false branch. PR paths start as pending.
The activity paginates all paths, verifies GitHub's reported changed-file count,
and rejects incomplete, duplicate, truncated, or over-3,000-file results. The
bounded result is persisted before evaluation. No repository file contents or
diffs are read. Recorded-event previews use only recorded evidence and clearly
report pending enrichment; examples are labeled as examples. Predicted actions
describe their outputs but never fabricate product IDs or approval.

## Identities, association, and durability

Delivery IDs correlate requests. The tenant/source/semantic-event unique key
deduplicates same-ID and different-ID redeliveries, including after rule edits.
Each accepted event has one logical run; immutable candidate versions are pinned
inside the acceptance transaction. All tenant fan-out receipts and outbox intents
commit atomically. A persistence failure rolls back the entire fan-out, allowing
safe redelivery without partially executing another tenant.

Workflow ID is `release-automation-<run-id>`. Temporal uses USE_EXISTING and
REJECT_DUPLICATE; lost dispatch acknowledgement recovers an existing open or
closed execution. Eligible recovery adds `-recovery-<attempt>` to the execution
ID while retaining the logical run, pinned version, and every action key.
`automation:<run-id>:<node-id>` is stored under tenant/run uniqueness. Domain
idempotency protects the gap between a successful mutation and its node receipt.
Completed receipts return their original product references.

Historical connection backfill is recorded separately and never dispatches
marketing workflows. Imported releases retain their historical output lineage;
later live redelivery of that semantic event is a duplicate.

For automated release association, a release's explicit PR references and the
provider occurrence cutoff establish membership. PR-defined releases attach that
PR only; deployments do not imply PR membership. Tenant, source, and repository
must all match. A late PR can attach to exactly one evidenced release if its merge
time precedes the cutoff. Unreferenced PRs remain collected. Ambiguous references
remain unassigned and emit `product.source_change_association_unresolved` in the
workspace audit trail. Operators must inspect source evidence before correcting
association; arrival order is never membership evidence. This version does not
offer a bulk manual association editor.

## Authorization and state

Existing workspace read permissions govern definitions, events, runs, versions,
and connection visibility. Owner/admin **sessions** manage connections, save or
activate definitions, change modes, disconnect, cancel, and retry. API keys and
service principals cannot authorize their own automation. Actions use a scoped
workspace service principal, never an administrator session. Existing channel
management still requires the product's two-factor authentication policy.

Tenant identity comes from the authenticated context or persisted run. Sources,
brands, destinations, releases, campaigns, posts, and versions are tenant-scoped
at their respective boundaries. Public/shared routes expose no automation history.

| Run state         | Meaning / recovery                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------------- |
| `queued`          | Durable dispatch is pending. Inspect outbox age if delayed.                                          |
| `running`         | Temporal has loaded the run; node receipts show progress.                                            |
| `succeeded`       | The selected path completed, possibly ending at human review.                                        |
| `skipped`         | Historical, source-filtered, no-match, or an explicit skip end.                                      |
| `failed`          | Infrastructure activity retries exhausted. Admin retry is offered only for `activity_failed`.        |
| `needs_attention` | Missing evidence, invalid configuration, or permanent access failure. Reconcile before further work. |
| `cancelled`       | Work was stopped; existing outputs are retained. No automatic restart.                               |

Activities use bounded retry/backoff and timeouts; file enrichment heartbeats.
An old recovery attempt cannot resume new actions or overwrite the new attempt's
terminal status. There is no `waiting_for_review` automation state because v1 ends
at submission; the campaign's review status remains authoritative.

Review transitions have a stable outbox key. Each notification recipient has a
durable receipt written **before** sending. A lost acknowledgement leaves
`UNKNOWN_DELIVERY`, and replay refuses to send again until reconciled. This trades
possible missing mail for preventing duplicate mail. It is not an exactly-once
external delivery guarantee. Existing publishing UNKNOWN_DELIVERY behavior is
unchanged; no automation action calls publishing.

## GitHub App and rollout

Use the existing backend-held `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`,
`GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_SLUG`, and
`GITHUB_APP_WEBHOOK_SECRET`. Keep the existing setup/OAuth callback URLs and
single-use state flow. The shared webhook remains `/api/webhooks/github`.

App repository permissions: Metadata read, Contents read (release events and
reads), Pull requests read (metadata and paths), Deployments read. Subscribe to
`release`, `pull_request`, and `deployment_status`, plus the App's installation
and installation-repository lifecycle events. No write permission, source-code
read operation, organization-membership permission, or per-customer webhook is
introduced. Existing installations may need an owner to approve permission changes.

1. Apply `20261026090000_release_automation.sql` with the existing platform
   migration command. It adds six tables and source mode/policy columns.
2. Deploy the Go backend and product worker. The worker registers
   `platform-release-automation-v1` on `platform-release-automation`, plus its v1
   activities. Enable existing maintenance/outbox dispatch and GitHub configuration.
   Maintenance retains its existing email/HTTPS configuration requirements.
3. Verify Temporal polling and a fresh executor capability lease. It expires after
   one minute without renewal; the production worker advertises only when GitHub
   and maintenance dispatch are configured. Activation fails closed without it.
4. Build/deploy the backend SDK and web together. Enable the existing campaign and
   content-draft feature configuration and required workspace entitlements.
5. Verify a controlled end-to-end event before enabling customer definitions.

The new webhook facade routes legacy and automation events through durable intake,
so deploy the worker before the web. Retain the v1 workflow/activity names and
deterministic interpreter for in-flight histories. Future interpreter changes need
Temporal versioning or a separate compatible workflow registration; graph schema
versioning alone is insufficient. Rollback must preserve the new tables/receipts
and sticky source mode. Do not roll the facade back to unconditional legacy intake
for opted-in sources; stop their intake/dispatch until compatible code is restored.

## Operations

The webhook returns 401 for invalid signatures, 400 for malformed supported
payloads, 202 for unsupported/unknown/inactive/duplicate deliveries, and 200 after
new durable acceptance. Persistence failures return an error, never success.
Acceptance has a six-second backend deadline and does no GitHub enrichment or
marketing work. GitHub does not automatically redeliver a failed delivery.

- **Before durable acceptance:** use GitHub App delivery history to inspect and
  manually redeliver the failed delivery after fixing storage/connectivity. Search
  by delivery and semantic event first. Do not invent a replacement provider event.
- **Stored event / outbox backlog:** inspect tenant outbox attempts, age, and
  dead letters. Restore the worker/Temporal, then use the existing authenticated
  tenant-outbox replay route. Stable workflow IDs make a lost start acknowledgement
  safe to recover. A customer run retry is a different operation.
- **Temporal outage or worker crash:** history remains in Postgres. Restore the
  same queue/registrations. Replayed activities use the same logical action keys.
- **GitHub rate limit:** rate-limit 403/429 responses are retryable with bounded
  backoff. If retries exhaust, wait for access to recover and use eligible run retry.
- **Revoked access:** reconnect/restore repository selection through the App flow.
  Cancelled work stays cancelled. Inspect preserved outputs before authorizing
  any new business action; a rule edit is not replay authorization.
- **Uncertain mail/provider outcome:** inspect the recipient receipt and provider
  logs. Confirm accepted vs definitely unsent before an operator repairs its
  disposition. Never clear an ambiguous receipt merely to make replay succeed.
- **Needs attention / association ambiguity:** inspect the recorded evidence,
  pinned version, node decision, and workspace audit trail. There is no blind
  retry button for an uncertain or permanently invalid run.

Structured `github_release_event` logs report accepted/duplicate/rejected/ignored
counts and acceptance latency. `release_automation_dispatch` correlates workspace,
logical run, Temporal execution, lag, start failure, and recovery attempt. Audit
events and persisted run/node states supply match/no-match, terminal outcome,
retry, access-revocation, and uncertain-notification evidence. Existing outbox
attempts/dead-letter reporting remains authoritative. Logs omit raw payloads,
credentials, and signed asset URLs.

Snapshots are bounded (512 KiB; notes 50,000 Unicode code points); raw webhook
payloads are not retained. History, versions, and receipts remain until workspace
purge, where the existing deletion job removes the new tenant records in dependency
order. There is no separate automatic age-based automation-history pruning in v1;
do not delete semantic/action receipts while redelivery must remain deduplicated.

## Verification

Pure contract/condition/normalization tests are in `internal/releaseautomation`;
Temporal interpreter and lost-acknowledgement tests in
`internal/temporalreleaseautomation`; database/tenant/action tests in
`internal/product/release_automation_integration_test.go`. Set
`PUBLISHING_TEST_DATABASE_URL` to an isolated migrated test database for the latter.

The opt-in `test/e2e/release-automation.spec.ts` drives real browser auth, workspace,
GitHub connection/source setup, draft validation, preview, activation, signed
delivery, a real local Temporal worker, and visible release/history. GitHub itself
is the protocol fixture `scripts/e2e-release-automation-mock.mjs`; this is not live
GitHub verification. Run instructions are in
[the fixture guide](./release-automation-fixture.md).
