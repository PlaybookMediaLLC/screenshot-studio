# RFC 022: GitHub Integration and Marketing-Worthy Change Detection

**Status:** Proposed
**Date:** 2026-08-17
**Revised:** 2026-08-26
**Depends on:** RFC 005 and RFC 021
**Owners:** Engineering

## Decision

Connect GitHub and detect marketing-worthy merged PRs. Suggest campaigns.
Do not publish automatically. Shipping the product starts to create the raw
material for marketing the product.

The output of this pipeline is a `ChangeSuggestion`, never a campaign. A
founder accepts a suggestion to run Workflow 2. An integration that silently
created campaigns from every merge would produce noise the founder learns to
ignore.

## Design

Pipeline:

```text
Merged PR
   ↓
classify external relevance
   ↓
understand feature/change
   ↓
find corresponding ProductSurface
   ↓
update product context
   ↓
suggest campaign
```

Example:

```text
PR #452 merged: "Add recurring invoices"
        ↓
Marketing-worthy change detected.
        ↓
"Create feature launch?"
```

## Goals

- Zero-effort detection of shippable changes worth announcing.
- High precision. A false positive costs founder trust; a false negative costs
  one campaign they can still request manually.
- No repository content in prompts beyond metadata and paths.
- Graceful behavior for high-volume repositories.

## Non-goals

- Automatic screenshot capture from deployments. RFC 023 covers that.
- Automatic publishing.
- Reading file contents or diffs. Titles, bodies, labels, and changed paths
  only.
- Issue tracking, code review, or any non-marketing GitHub feature.

## GitHub App

A GitHub App delivers webhook events to the existing webhook infrastructure
with signature verification.

Requested permissions, minimum viable:

| Permission              | Level | Why                                        |
| ----------------------- | ----- | ------------------------------------------ |
| Metadata                | Read  | Required baseline                          |
| Pull requests           | Read  | Titles, bodies, labels, changed file paths |
| Contents                | None  | We never read source code                  |
| Releases                | Read  | Release notes as a stronger signal         |

Subscribed events: `pull_request` (closed), `release` (published), and
`installation` lifecycle events.

Requesting no `contents` access is a deliberate product decision, not only a
security one. "We never read your source code" is a sentence worth being able
to say to a founder evaluating the integration, and it is enforced by the
permission rather than by policy.

### Installation mapping

```ts
GitHubInstallation {
  id
  workspaceId
  installationId        // unique across the platform
  accountLogin
  accountType           // User | Organization
  repositories[]        // selected repository IDs, or 'all'
  status                // active | suspended | revoked
  connectedByUserId
  installedAt
}
```

- One installation maps to exactly one workspace. A second workspace claiming
  the same installation is refused.
- Mapping is established through an authenticated OAuth callback carrying a
  signed state value bound to the session and the workspace. A webhook alone
  never creates a mapping, because a webhook is unauthenticated with respect to
  our workspaces.
- `installation.deleted` and `suspend` mark the record and stop processing
  without deleting history.
- Repository selection changes update the allowlist; events from unselected
  repositories are dropped.

## Webhook handling

The route is one of the raw-body exceptions to tRPC described in RFC 007.

1. Read the raw body and verify `X-Hub-Signature-256` with HMAC-SHA256 in
   constant time. Invalid signatures return `401` with no detail.
2. Reject deliveries whose timestamp is older than 5 minutes.
3. Store `X-GitHub-Delivery` and drop duplicates. GitHub retries, and retries
   must not produce two suggestions.
4. Resolve the installation to a workspace. Unknown installations are recorded
   and dropped.
5. Enqueue an outbox event and return `202` within the delivery timeout.
6. Process asynchronously.

Returning quickly and processing later is required: classification calls a
model, and holding a webhook connection open for it guarantees delivery
failures and retries.

Replay is defended by delivery-ID deduplication plus the timestamp window, and
by idempotent downstream processing keyed on `(repositoryId, prNumber,
mergeCommitSha)`.

## Change worthiness

Classification is two-stage, cheap first.

### Stage 1: deterministic filters

Dropped before any model call:

| Condition                                     | Reason                     |
| --------------------------------------------- | -------------------------- |
| PR closed without merging                     | Nothing shipped            |
| Base branch is not a release branch           | Not in production          |
| Author is a known bot                         | Dependency noise           |
| Title matches chore, docs, test, ci, refactor, build, style | Conventional non-features |
| Every changed path is internal                | Tests, CI, config, docs    |
| Labeled `internal`, `no-marketing`, `chore`   | Explicit opt-out           |
| Fewer than a minimum number of changed files  | Trivial                    |
| Repository not in the allowlist               | Out of scope               |

Path classification uses a default rule set plus workspace overrides, so a team
whose UI lives in an unusual directory can correct it once.

The filters are the precision mechanism. Most merges in most repositories are
not marketing events, and cheap rules should remove them before spending a
model call.

### Stage 2: model classification

One schema-validated call over the title, body, labels, and changed paths.
Never file contents.

```ts
{
  isExternallyMeaningful: boolean
  confidence: 0.0-1.0
  changeType: 'feature' | 'improvement' | 'fix' | 'performance' | 'internal'
  userFacingSummary: string        // one sentence, founder-readable
  suggestedFeatureName: string
  affectedSurfaceHints: string[]
}
```

Thresholds:

| Confidence  | Action                                             |
| ----------- | -------------------------------------------------- |
| ≥ 0.75      | Create a suggestion                                |
| 0.5 – 0.75  | Create a low-confidence suggestion, visually muted |
| < 0.5       | Record the decision, create nothing                |

Every decision is recorded either way, so the filter is tunable against real
data and a founder can ask why a PR produced nothing.

### Prompt injection

PR titles and bodies are attacker-controlled in any repository accepting
outside contributions. The defenses match RFC 012: content is delimited data,
the call has no tools, output is schema-constrained, and the result is a
suggestion a human accepts. A successful injection produces a suggestion the
founder declines.

## Suggestions

```ts
ChangeSuggestion {
  id
  workspaceId
  source                // github_pr | github_release
  externalRef           // repo, PR number, merge SHA
  title
  summary
  changeType
  confidence
  matchedSurfaceIds[]
  status                // pending | accepted | dismissed | expired | superseded
  campaignId?           // set on acceptance
  createdAt
  decidedAt, decidedByUserId
}
```

Behavior:

- A suggestion is created, not a campaign. Accepting runs Workflow 2 (RFC 021).
- Dismissing records the reason and feeds filter tuning.
- Suggestions expire after 30 days. A month-old merge is no longer news.
- Related merges within a short window merge into one suggestion rather than
  producing several, since a feature often lands across several PRs.
- Suggestions are deduplicated on `(repositoryId, prNumber)`.

### Volume control

Active repositories merge many PRs. Without limits, this becomes a notification
firehose.

| Limit                            | Default        |
| -------------------------------- | -------------- |
| Suggestions per workspace per day| 3              |
| Suggestions per workspace per week| 10            |
| Classification calls per hour    | Plan-scoped    |
| Grouping window for related PRs  | 24 hours       |

At the cap, further qualifying changes accumulate into a digest suggestion
naming several changes rather than being dropped. A weekly digest of five
shipped improvements is often better marketing material than five separate
announcements.

## Product context updates

An accepted or high-confidence suggestion updates `ProductProfile` under the
RFC 012 precedence rules, at `github` rank:

- A new feature may be added to `features[]`.
- Manually locked fields are never overwritten.
- Updates from a dismissed suggestion are reverted.

GitHub outranks page extraction because a merged PR is stronger evidence than a
marketing page, and ranks below manual edits because the founder is
authoritative about their own product.

## Backfill

On connection, backfill the last 30 days of merged PRs, capped at 100, running
the same filters. Backfill produces at most one digest suggestion rather than
30 individual ones, and is clearly labeled as historical.

Backfill is rate-limit aware and resumable. It never blocks connection: the
integration is usable immediately and backfill completes in the background.

## Rate limits

- Respect `X-RateLimit-Remaining` and `Retry-After`, backing off before
  exhaustion.
- Use installation tokens, cached until shortly before expiry.
- Secondary rate limits back off exponentially with jitter.
- Per-installation request budgets prevent one busy workspace from consuming
  the platform's allowance.
- Webhook payloads carry most needed data, so steady-state API use is low.

## Authorization

| Operation             | Permission           |
| --------------------- | -------------------- |
| Connect GitHub        | `workspace:update`   |
| Disconnect            | `workspace:update`   |
| View suggestions      | `workspace:read`     |
| Accept a suggestion   | `release:create`     |
| Dismiss a suggestion  | `release:create`     |
| Edit path rules       | `workspace:update`   |

Webhook processing runs as a service principal scoped to the resolved
workspace. It can create suggestions and update product context. It cannot
create campaigns, approve, or publish.

## Failure behavior

| Failure                        | Behavior                                        |
| ------------------------------ | ----------------------------------------------- |
| Invalid signature              | `401`, no processing, security event            |
| Duplicate delivery             | `202`, no processing                            |
| Unknown installation           | Recorded and dropped                            |
| Workspace suspended            | Event stored, processing deferred               |
| Classification fails           | Retried twice, then recorded with no suggestion |
| Model outage                   | Events queue; drained on recovery               |
| Rate limited                   | Backoff; webhook processing continues           |
| Installation revoked mid-run   | Processing stops; history retained              |

No GitHub failure ever affects campaign creation, approval, or publishing. The
integration is a suggestion source, and it must be able to be entirely down
without degrading the core product.

## Observability

- Events received, filtered by stage, and classified.
- Suggestion creation rate and acceptance rate, which is the precision metric.
- Dismissal reasons.
- Classification cost per workspace.
- Rate-limit proximity per installation.
- Time from merge to suggestion.

Acceptance rate is the number that decides whether the feature stays. Below
roughly one in three, the filters are wrong and the feature is generating
noise.

## Acceptance criteria

1. A merged, externally meaningful PR produces "We noticed you shipped X.
   Create a feature launch?" within minutes. Internal PRs produce nothing.
2. An invalid signature is rejected with no processing.
3. A duplicate delivery ID produces exactly one suggestion.
4. A replayed delivery outside the timestamp window is rejected.
5. A bot-authored dependency PR produces nothing and costs no model call.
6. A `chore:` PR is filtered before classification.
7. A PR labeled `no-marketing` produces nothing.
8. A PR body containing injected instructions changes no control flow.
9. No prompt ever contains file contents or a diff.
10. Accepting a suggestion runs Workflow 2 and produces a `DRAFT` campaign.
11. Dismissing records a reason and updates no product context.
12. Three related PRs within 24 hours produce one suggestion.
13. Exceeding the daily cap produces a digest, not dropped changes.
14. Connecting backfills 30 days as one historical digest.
15. An installation cannot be claimed by a second workspace.
16. Revoking the installation stops processing and retains history.
17. GitHub being unavailable does not affect any other product function.

## Rollout

1. Ship the GitHub App, installation mapping, and webhook verification with
   storage only. Classify nothing.
2. Run deterministic filters in shadow mode on real repositories; measure how
   many events survive.
3. Add classification in shadow mode; measure precision against founder
   judgment before showing anything.
4. Enable suggestions for internal workspaces; measure acceptance.
5. Enable broadly with volume caps.
6. Add backfill and digests.

Shadow mode before exposure is essential here. The cost of launching a noisy
detector is that founders disable the integration and do not re-enable it.

## Out of scope

- Automatic screenshot capture from deployments. RFC 023 covers that.
- Automatic publishing.
- GitLab and Bitbucket, which reuse the same suggestion model later.
