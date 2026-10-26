# Epic CHAN: Channels and connections

Reconciled against `19390194` and the implementation in this working tree. The October 23 expansion deferral is reopened by this assignment. [Execution](execution.md) distinguishes observed local test results from external provider verification.

## WI-CHAN-1: Connect accounts within social sets

**Gap:** Verify: retain the existing behavior and execute the feature-specific regressions below.

**Priority:** Reopened expansion. **Size:** M; live provider activation remains separately gated.

**Source:** TF-010, TF-035, TF-041, TF-047, TF-048, TF-062, TF-067. [Source requirements](../changelog-features.md).

**Dependencies:** Workspace connection permissions; provider credentials; plan channel limits.

**Affected code and current evidence:** `components/settings/social-sets`; `components/write/composer/platforms.tsx`; `services/internal/product/social_sets.go`; `services/internal/social/tenantpublishing/provider.go`; `services/internal/social/integrations/social/bluesky`.

### Implementation gap and disposition

Current code supports multiple accounts, platform-primary drafts and Bluesky app-password connection. Revalidate account identity rather than accepting the old triage claim that Bluesky only connects through an API.

### Acceptance criteria

Connect and select X, LinkedIn, Threads, Mastodon and Bluesky through their supported forms; preserve defaults after refresh. A LinkedIn-only draft requires no X account. Transfer/copy drafts only between visible authorized sets. Disabled, stale, private or foreign connections cannot receive a publishing command.

### Failure behavior

Keep a draft editable when connection or app review fails. Never invent Notes OAuth, provider scopes or account capability. Store secrets only through the existing backend secret references.

### Verification

`services/internal/product/social_sets_integration_test.go`; `services/internal/product/bluesky_capabilities_integration_test.go`; `services/internal/product/social_health_integration_test.go`; `test/e2e/social-set-scope.spec.ts`. Execute the relevant tests and record results in the coverage matrix; listed tests alone do not certify this item.

### Observability and activation

Connection health, verification timestamp, granted scopes and provider errors describe readiness. Local fixture identity verification is not live OAuth certification.

## WI-CHAN-2: Use supported identity providers

**Gap:** Partial at the audited baseline; source evidence and the implemented slice are recorded below.

**Priority:** Reopened expansion. **Size:** M; live provider activation remains separately gated.

**Source:** TF-082. [Source requirements](../changelog-features.md).

**Dependencies:** Better Auth provider app registration and email policy.

**Affected code and current evidence:** `lib/auth/environment.ts`; `components/auth/AuthForm.tsx`; `lib/auth/server.ts`.

### Implementation gap and disposition

Optional X and LinkedIn sign-in are configured through complete credential pairs. Collaboration does not require connecting a publishing account. X sign-in requires verified email according to the existing identity policy.

### Acceptance criteria

Show only configured identity providers; preserve the post-sign-in destination and URL-import review. Do not couple sign-in identity to publish authorization or silently link accounts by unverified email. Keep primary platform and synced per-platform versions independent of the identity provider.

### Failure behavior

Incomplete provider configuration stays hidden. Callback and account-link failures do not create an authenticated publishing identity.

### Verification

`test/auth-methods.test.ts`; `test/e2e/onboarding.spec.ts`; `test/e2e/typefully-workitems.spec.ts`. Execute the relevant tests and record results in the coverage matrix; listed tests alone do not certify this item.

### Observability and activation

Existing authentication event/error handling applies. Live X/LinkedIn identity callbacks require registered applications and allowed redirect URLs.

## WI-CHAN-3: Resolve Substack publishing support

**Gap:** Later: the specific product decision or missing provider contract is recorded below.

**Priority:** Reopened expansion. **Size:** M; live provider activation remains separately gated.

**Source:** TF-103. [Source requirements](../changelog-features.md).

**Dependencies:** A documented official Notes publishing API plus authorized app access.

**Affected code and current evidence:** `lib/write/capabilities.ts`; `services/internal/social/integrations/social`.

### Implementation gap and disposition

Later: no reliable official Notes publish contract or approved integration was established. This assignment authorizes implementation where supported; it does not authorize private-cookie automation or an invented endpoint.

### Acceptance criteria

Reopen when official authorization, create/read result semantics, rate limits and duplicate-delivery behavior are documented. At that point add a provider adapter and the complete connection → schedule → confirmed publication workflow.

### Failure behavior

Do not list Notes as a working publishing destination. Preserve existing channels and clearly record this external dependency.

### Verification

`Provider research and capability inventory`; `no publish test can be truthfully reported for a nonexistent integration.`. Execute the relevant tests and record results in the coverage matrix; listed tests alone do not certify this item.

### Observability and activation

This item remains deferred and incomplete; there are no fabricated successful Notes receipts.
