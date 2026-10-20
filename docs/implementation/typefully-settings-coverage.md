# Typefully settings: implementation coverage

Tracks [the settings specification](../scheduling/typefully/settings/typefully-settings-spec.md)
against Screenshot Studio. The design is [RFC 043](../rfcs/043-settings-platform.md).

Status values: **Complete and verified**, **Implemented but incomplete**,
**Missing**, **Blocked by external dependency**. Nothing is marked complete from
reading code alone; each "verified" row names the test that proves it.

Audit baseline: `main` at `1c46737d` (2026-10-20).

## 1. Settings architecture

1. **Required.** One settings hierarchy (Personal, Workspace, Publishing
   identities) with addressable URLs, back and forward, deep links, access from
   the composer that keeps unsaved work, the selected set kept apart from the
   section, and loading, empty, saved, saving, error, permission, disconnected,
   unavailable and destructive-confirmation states.
2. **Existing.** Route-based settings at `/workspace/[[...section]]` with 18
   flat sections (`components/workspace/settings-sections.ts`). Navigation is the
   sidebar only; there is no in-page section list and no nested route.
3. **Verified.** `test/e2e/workspace-settings.spec.ts` covers saving General,
   Account, Brand kit and Product pages.
4. **Missing.** Groups, nested social-set routes, in-page navigation, composer
   access, a composer that flushes its pending save before unmounting (edits in
   the last 800 ms were dropped).
5. **Files.** `components/workspace/settings-sections.ts`,
   `WorkspaceSettings.tsx`, `WorkspaceSettingDetail.tsx`,
   `app/[locale]/workspace/[[...section]]/page.tsx`,
   `components/drafts/DraftComposer.tsx`.
6. **Migrations.** None.
7. **Authorization.** Each section keeps its existing gate; new sections
   declare theirs in RFC 043.
8. **Automated verification.** Acceptance 7 (composer content survives
   settings navigation).
9. **External dependencies.** None.
10. **Status.** Implemented but incomplete.

## 2. Account-level controls

### Your user

1. **Required.** Avatar and name, notification email with change, display time
   zone with detect, sign-in method, log out, log out everywhere, reset help
   tips, account deletion request.
2. **Existing.** `components/auth/ProfileForm.tsx` edits the name only. Sign out
   exists in `AccountMenu.tsx`. Better Auth's session endpoints exist but nothing
   calls them. No change-email, deletion, time zone, or help-tip state.
3. **Verified.** Name save (`workspace-settings.spec.ts`).
4. **Missing.** Everything else listed in 1.
5. **Files.** `lib/auth/server.ts` (change email), new
   `services/internal/product/user_preferences.go`, `account_deletion.go`.
6. **Migrations.** `user_preference`, `account_deletion_request`.
7. **Authorization.** The signed-in person only; deletion needs a fresh
   session and two-factor when enabled.
8. **Automated verification.** Go integration tests; acceptance 1 and 14.
9. **External dependencies.** Change-email verification mail needs the auth
   mail transport (`RESEND_API_KEY` or SMTP) in each environment.
10. **Status.** Missing.

### Notifications

1. **Required.** Email master switch, notification address, in-app, Slack with
   health, test send, comment events (replies, new comments, mentions), and per
   social set: post published, auto-retweet published, auto-plug published,
   failures.
2. **Existing.** Personal preferences and workspace policy per event and channel
   (`components/workspace/WorkspaceNotifications.tsx`, `lib/notifications/`),
   durable deliveries with idempotency, bounded retries, receipts and recovery
   (`services/internal/notifications/delivery.go`). One workspace Slack channel.
3. **Verified.** `test/e2e/workspace-notifications.spec.ts`.
4. **Missing.** Email master switch, per-set preferences, set visibility in
   recipient selection, auto-action published events, Slack DMs.
5. **Files.** `services/internal/notifications/`, `services/internal/activity/events.go`,
   `lib/notifications/schema.ts`.
6. **Migrations.** Per-set preference column.
7. **Authorization.** Personal rows by their owner; policy by owner or admin.
8. **Automated verification.** Go delivery tests for set filtering.
9. **External dependencies.** Slack DMs need the Slack app to request
   `im:write` and `users:read.email` and every workspace to reinstall it; not
   available.
10. **Status.** Implemented but incomplete.

### Appearance

1. **Required.** Navigation (compact, dynamic, expanded), theme (light, dark,
   system), week start, editor direction, scrollbars with a Safari note.
2. **Existing.** None. The app is hard-coded dark (`app/layout.tsx`),
   `next-themes` is installed but unused, the rail is always compact, the
   calendar always starts Monday.
3. **Verified.** Nothing.
4. **Missing.** All of it.
5. **Files.** `components/platform-shell/PlatformSidebar.tsx`, root layout, theme
   tokens, `app/[locale]/drafts/calendar/page.tsx`, the composer editor.
6. **Migrations.** `user_preference`.
7. **Authorization.** The signed-in person.
8. **Automated verification.** Acceptance 15.
9. **External dependencies.** None.
10. **Status.** Missing.

### Billing

1. **Required.** Plan, status, interval, allowances, credits, manage
   subscription, plans, payment method, cancellation, portal.
2. **Existing.** `components/workspace/WorkspaceBilling.tsx` shows plan, status
   and allowances; Checkout and the Stripe portal through `lib/billing/stripe.ts`;
   entitlements change only from verified Stripe webhooks.
3. **Verified.** `test/billing-checkout-return.test.ts`, `billing-signature.test.ts`.
4. **Missing.** Interval, renewal, cancel-at-period-end, direct payment-method
   and cancellation flows, the consequences of cancelling.
5. **Files.** `lib/billing/stripe.ts`, `lib/trpc/routers/billing.ts`.
6. **Migrations.** None.
7. **Authorization.** `workspace:update` to change; `workspace:read` to view.
8. **Automated verification.** Unit tests with a Stripe fixture.
9. **External dependencies.** Live portal flows need Stripe credentials; tests
   never touch live billing.
10. **Status.** Implemented but incomplete.

### Install

1. **Required.** Truthful install methods.
2. **Existing.** `public/site.webmanifest` (standalone, icons). No service
   worker. No desktop application exists in the repository or its releases.
3. **Verified.** Nothing.
4. **Missing.** The section.
5. **Files.** New `components/settings/InstallSettings.tsx`.
6. **Migrations.** None.
7. **Authorization.** None.
8. **Automated verification.** E2E renders the section without a download link.
9. **External dependencies.** A Mac app would be a separate signed, notarized
   release; none exists, so none is offered.
10. **Status.** Missing.

### Experimental

1. **Required.** A registry with status, entitlement, dependencies and server
   enforcement.
2. **Existing.** No feature flags beyond plan features and environment switches.
3. **Verified.** Nothing.
4. **Missing.** All of it.
5. **Files.** New `lib/experiments/`, `services/internal/product/experiments.go`.
6. **Migrations.** Opt-ins in `user_preference`; admin switch on
   `workspace_settings`.
7. **Authorization.** Opt-in by the person; workspace switch by owner or admin.
8. **Automated verification.** Go test refusing a disabled experiment.
9. **External dependencies.** None.
10. **Status.** Missing.

## 3. Social-set management

1. **Required.** List with name, colour, accounts, health, sharing; create,
   rename, colour, select, add, reconnect and remove accounts, defaults,
   sharing, delete; same-name sets by ID; team creation.
2. **Existing.** Channels are workspace-level (`ChannelConnection`), connected
   through social OAuth. No social set. No channel removal. Product-side
   channel status is always `ACTIVE`; real health lives in the social service.
   Workspaces are the team model.
3. **Verified.** `test/e2e/social-scheduling.spec.ts` covers connecting.
4. **Missing.** The social set model and everything on it.
5. **Files.** New `services/internal/product/social_sets.go`, the OAuth start
   record, `publishing/oauth.go`, draft and channel queries.
6. **Migrations.** `social_set`, `channel_connection.socialSetId`,
   `content_draft.socialSetId`, the backfill in RFC 043.
7. **Authorization.** RFC 043's table.
8. **Automated verification.** Acceptance 8, 9, 10; cross-workspace and
   private-set Go tests.
9. **External dependencies.** Live provider reconnects need provider apps.
10. **Status.** Missing.

## 4. Scheduling

1. **Required.** Set time zone with offset and detect, weekly grid, 15-minute
   add, count, natural times (±4 minutes) with a draft override, preserved
   instants, DST rules, atomic slots.
2. **Existing.** Workspace-wide slots (`content_draft_settings`), workspace time
   zone, `NextQueueSlot` read-only suggestion with no reservation and no DST
   rule.
3. **Verified.** `content_draft_platform_integration_test.go` (sequential next
   slot).
4. **Missing.** Per-set configuration, reservation, DST, natural times.
5. **Files.** `services/internal/product/content_draft_platform.go`,
   `content_draft_schedule.go`, `components/drafts/DraftSettingsForm.tsx`.
6. **Migrations.** Set schedule columns; scheduled-post explanation columns.
7. **Authorization.** `publish:manage` to change; visibility to read.
8. **Automated verification.** Acceptance 1, 2, 3, 6; DST and concurrency Go
   tests.
9. **External dependencies.** None.
10. **Status.** Missing.

## 5. New-draft defaults

1. **Required.** Ordered default platforms, primary, sync rule, connect more,
   X engagement defaults, snapshot semantics.
2. **Existing.** Drafts store ordered `channelConnectionIds` and per-channel
   text overrides. X follow-ups exist per schedule
   (`services/internal/postoptions`).
3. **Verified.** Draft scheduling e2e.
4. **Missing.** Set defaults and the snapshot.
5. **Files.** `content_drafts.go`, `DraftComposer.tsx`, `XOptions.tsx`.
6. **Migrations.** Set default columns; draft snapshot columns.
7. **Authorization.** `publish:manage`.
8. **Automated verification.** Acceptance 4, 5.
9. **External dependencies.** None.
10. **Status.** Missing.

## 6. Public profile and AI writing preferences

1. **Required.** Per-set public profile enforced by the server; per-set Writing
   Assistant with a lifecycle, style guide and samples.
2. **Existing.** Workspace brand voice and prohibited terms (`brand_profile`),
   metered AI writing help for drafts (`lib/content-drafts/assist.ts`).
3. **Verified.** `test/e2e/content-drafts-platform.spec.ts` (AI help).
4. **Missing.** Both features.
5. **Files.** New public route `app/[locale]/p/[slug]/page.tsx`, Go public
   endpoint, `lib/content-drafts/assist.ts`.
6. **Migrations.** Set public columns, `social_set_writing_sample`.
7. **Authorization.** `publish:manage` for the profile; `artifact:edit` for
   writing settings.
8. **Automated verification.** Acceptance 11; precedence unit test.
9. **External dependencies.** Live generation needs the OpenRouter key.
10. **Status.** Missing.

## 7. Integrations, API and webhooks

1. **Required.** Catalogue (Claude, ChatGPT, MCP, Agent Skills, Notion Agents,
   Slack, Zapier, Raycast), API keys, outbound webhooks, development mode, debug
   logging.
2. **Existing.** MCP server with OAuth consent and agent keys, Slack, Notion,
   Figma; API keys with scopes, expiry and revocation (shown once); inbound
   signed webhooks; audit drains with an SSRF-safe dialer. No outbound
   customer webhooks, no Zapier or Raycast app.
3. **Verified.** `test/e2e/ai-agents.spec.ts`, `api-key-releases.spec.ts`,
   `webhook-release.spec.ts`.
4. **Missing.** Catalogue, key dates and last use, revoke confirmation,
   outbound webhooks, draft tags and planning, development mode, debug logs.
5. **Files.** `components/workspace/WorkspaceDeveloperSettings.tsx`, new
   `services/internal/webhooks/`, `services/internal/maintenance/outbox.go`.
6. **Migrations.** `webhook_subscription`, `webhook_delivery`,
   `webhook_delivery_attempt`, draft `tags` and `plannedFor`.
7. **Authorization.** Webhooks and keys: owner or admin.
8. **Automated verification.** Acceptance 12, 13; SSRF, signing, retry and
   replay Go tests.
9. **External dependencies.** Zapier and Raycast publish no app for Screenshot
   Studio; Slack DMs as above.
10. **Status.** Implemented but incomplete.

## 8. Data model

1. **Required.** Entities in the spec's table, with entitlements kept apart.
2. **Existing.** Users, organizations, members, API keys, channel connections,
   drafts, scheduled posts, notification preferences.
3. **Verified.** Schema tests.
4. **Missing.** Preferences, sets, writing profile, webhooks.
5. **Files.** `services/ent/schema/`, `services/platformmigrations/sql/`.
6. **Migrations.** As listed above.
7. **Authorization.** Per RFC 043.
8. **Automated verification.** Migration test against a fresh database.
9. **External dependencies.** None.
10. **Status.** Missing.

## 9. Persistence and interaction contract

1. **Required.** Immediate saves with failure feedback and rollback, explicit
   submission for creation, separate personal and shared state, stable IDs.
2. **Existing.** Explicit Save buttons on most forms; the composer autosaves
   with version checks.
3. **Verified.** Composer conflict handling e2e.
4. **Missing.** Confirmed immediate saves for preferences.
5. **Files.** New `lib/settings/` client.
6. **Migrations.** Version columns.
7. **Authorization.** n/a.
8. **Automated verification.** Acceptance 14.
9. **External dependencies.** None.
10. **Status.** Missing.

## 10. Acceptance checks

| # | Check | Test | Result |
| --- | --- | --- | --- |
| 1 | Display time zone does not change set time zone | pending | Not run |
| 2 | Editing slots keeps scheduled instants | pending | Not run |
| 3 | Two rows Monday to Friday count 10 | pending | Not run |
| 4 | New drafts get ordered defaults | pending | Not run |
| 5 | Changing defaults leaves drafts | pending | Not run |
| 6 | Natural offset stable across reload and retry | pending | Not run |
| 7 | Settings navigation keeps editor content | pending | Not run |
| 8 | Same-name sets addressable | pending | Not run |
| 9 | Disconnected accounts guide recovery and cannot publish | pending | Not run |
| 10 | Private-to-team sharing needs authorization | pending | Not run |
| 11 | Public profile enforced server-side, including cache | pending | Not run |
| 12 | Webhook validation, signing, retry, deduplication | pending | Not run |
| 13 | API credentials stay secret | pending | Not run |
| 14 | Failed saves do not show as saved | pending | Not run |
| 15 | Theme, week start and direction change the UI | pending | Not run |

## 11. Coverage limits

Provider behaviour (OAuth consent, token refresh, live publishing, live Stripe
portal flows, Slack delivery) is verified only with fixtures here unless a row
says otherwise. Each blocked row names its prerequisite.
