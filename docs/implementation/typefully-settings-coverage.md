# Typefully settings: implementation coverage

Tracks [the settings specification](../scheduling/typefully/settings/typefully-settings-spec.md)
against Screenshot Studio. The design is [RFC 043](../rfcs/043-settings-platform.md).

Status values: **Complete and verified**, **Implemented but incomplete**,
**Missing**, **Blocked by external dependency**. Nothing is marked complete from
reading code alone; each "verified" item names the test that proves it. A row
that mixes verified work with a blocked part is **Implemented but incomplete**
and names the blocker.

Audit baseline: `main` at `1c46737d`. Implementation verified on 2026-10-20,
rebased on `main` at `4c238b90`, on a local isolated stack (Compose project
`quito`) with fixtures for every external provider. Nothing here is verified in
production.

Test evidence used below:

- **Go**: `go test ./... -p 1` and `go vet ./...` in `services/` against
  PostgreSQL 16; every package passes. RFC 043 tests:
  `internal/product/social_sets_integration_test.go` (`TestSocialSetsPlatform`,
  12 subtests), `webhooks_integration_test.go` (`TestOutboundWebhookDelivery`),
  `settings_platform_test.go` (DST, slot times, natural offset, account health,
  writing context precedence), `internal/webhooks/webhooks_test.go` (SSRF,
  private dial, signing and sealing), `internal/notifications/social_sets_test.go`
  (`TestSocialSetNotificationGating`), `platformmigrations` (fresh database) and
  `TestEntProjectionsMatchMigratedTables`.
- **Web unit**: `npm run test` (798 root tests and 24 workspace tests pass),
  including `test/zoned-time.test.ts`, `test/settings-platform-web.test.ts`
  (debug-log redaction and bounds, settings sections, writing-sample fence) and
  `test/billing-subscription-cycle.test.ts`.
- **Repository checks**: `build:sdk`, `format:check`, `lint --max-warnings=0`,
  `typecheck`, `verify:rfcs` (17/17) and `build` pass.
- **Browser**: `test/e2e/settings-platform.spec.ts` (four flows, Playwright,
  Chromium) passes on the local stack, as do the existing draft, settings,
  role, API key, agent and shell specs. The notification spec needs its
  provider fixture and was not run; the notification changes are covered by
  Go tests. Every settings page was captured and reviewed at 1440 px and
  390 px; the PR description lists what each shows.

## 1. Settings architecture

1. **Required.** One hierarchy (Personal, Workspace, Publishing identities),
   addressable URLs, back and forward, deep links, composer access that keeps
   unsaved work, and every UI state.
2. **Built.** `components/workspace/settings-sections.ts` groups 23 sections;
   each has its own route under `/workspace`, and social sets nest as
   `/workspace/social-sets/{id}/{page}`. `components/settings/SettingsNav.tsx`
   is the in-page navigation. The composer opens a set's settings in a drawer
   named in the address (`?settings=scheduling`), so the editor never unmounts,
   and it flushes pending edits before leaving the page.
3. **Verified.** E2E: back and forward between sections; the drawer opens from
   a draft, back closes it, and typed text is still there and saved. Saving,
   saved and error states: E2E (a refused save shows "Not saved" and restores
   the choice).
4. **Not verified in a browser.** Permission-denied, disconnected and
   unavailable states are covered by Go authorization tests and screenshots, not
   by assertions.
5. **Files.** `settings-sections.ts`, `WorkspaceSettings.tsx`,
   `WorkspaceSettingDetail.tsx`, `app/[locale]/workspace/[[...section]]/page.tsx`,
   `components/drafts/DraftSettingsDrawer.tsx`, `DraftComposer.tsx`.
6. **Migrations.** None.
7. **Authorization.** Each section keeps its gate; new ones follow RFC 043.
8. **Automated verification.** Acceptance 7 and 14.
9. **External dependencies.** None.
10. **Status.** Implemented but incomplete (some states are verified by
    screenshot only).

## 2. Account-level controls

### Your user

1. **Required.** Avatar and name, notification email with change, display time
   zone, sign-in methods, log out, log out everywhere, reset help tips, account
   deletion request.
2. **Built.** `components/settings/AccountSettings.tsx`: name and avatar,
   verified email change (Better Auth `changeEmail` with a confirmation mail),
   display time zone (search, offset, detect, preview), sign-in methods,
   sessions with log out and log out everywhere, help-tip reset, and a deletion
   request with a 14-day grace period
   (`services/internal/product/account_deletion.go`, the `account-deletions`
   maintenance job).
3. **Verified.** E2E: the display time zone saves and survives a reload. Go: an
   owner of a live workspace cannot request deletion. Existing E2E: name save.
4. **Not verified.** The email-change confirmation mail and the session list in
   a browser.
5. **Files.** `lib/auth/server.ts`, `lib/auth/transactional-email.ts`,
   `user_preferences.go`, `account_deletion.go`,
   `internal/maintenance/accounts.go`.
6. **Migrations.** `user_preference`, `account_deletion_request`.
7. **Authorization.** The signed-in person; deletion needs a session under 15
   minutes old and the sign-in email typed to confirm.
8. **Automated verification.** Acceptance 1.
9. **External dependencies.** The change-email confirmation needs a mail
   transport (`RESEND_API_KEY` or SMTP); not sent in tests.
10. **Status.** Implemented but incomplete (email change mail is unverified).

### Notifications

1. **Required.** Email switch, comment events (replies, comments on your
   drafts, mentions), per-set publishing events, Slack.
2. **Built.** An email master switch (`user_preference.emailNotifications`),
   honoured at fan-out and before each send. Comment events: `comment.created`
   (replies, to thread participants), `comment.on_your_draft` (to the draft's
   author), `member.mentioned`. Per-set switches for published, auto-retweet,
   auto-plug and failures (`platform_notification_preference.social_sets`).
   Activity on a private set reaches only its owner and never Slack.
3. **Verified.** Go `TestSocialSetNotificationGating` (per-set switch, private
   set, email switch). E2E: the email switch saves and survives a reload.
4. **Missing.** Slack direct messages.
5. **Files.** `services/internal/notifications/`, `internal/activity/events.go`,
   `components/settings/NotificationExtras.tsx`,
   `components/workspace/WorkspaceNotifications.tsx`.
6. **Migrations.** `platform_notification_preference.social_sets`.
7. **Authorization.** Personal rows by their owner.
8. **Automated verification.** As above.
9. **External dependencies.** Slack DMs need the Slack app to request `im:write`
   and `users:read.email` and every workspace to reinstall it. The page says DMs
   are not available.
10. **Status.** Implemented but incomplete (Slack DMs blocked by the Slack app's
    scopes).

### Appearance

1. **Required.** Navigation (compact, dynamic, expanded), theme (light, dark,
   system), week start, editor direction, scrollbars with a Safari note.
2. **Built.** `components/settings/AppearanceSettings.tsx`; next-themes on
   platform routes (`lib/settings/appearance.ts`), with the editor and marketing
   pages kept dark; three sidebar modes remembered in a cookie; week start in
   the calendar; `dir` on the composer; hidden scrollbars with the Safari note.
3. **Verified.** E2E: light theme applies to `<html>` and survives a reload;
   week start saves; right-to-left sets `dir="rtl"` on the draft editor; a
   refused save restores the previous theme.
4. **Not verified by assertion.** Sidebar modes and scrollbars (screenshots
   only). The workflows pages that landed on `main` are not themed yet and stay
   dark.
5. **Files.** `app/layout.tsx`, `components/platform-shell/`, `app/globals.css`.
6. **Migrations.** `user_preference`.
7. **Authorization.** The signed-in person.
8. **Automated verification.** Acceptance 15.
9. **External dependencies.** None.
10. **Status.** Implemented but incomplete (two settings verified by screenshot
    only).

### Billing

1. **Required.** Plan, status, interval, allowances, credits, renewal,
   cancellation and its consequences, payment method, plans.
2. **Built.** `WorkspaceBilling.tsx` shows plan, status, allowances, credits,
   the billing interval, the renewal date or the scheduled end date, and what
   ending a plan means. The Stripe portal changes plans (Pro and Business,
   monthly or annual), the card, invoices and cancellation; Enterprise goes
   through sales. There is no Creator plan.
3. **Verified.** `test/billing-subscription-cycle.test.ts` (renewal,
   cancel-at-period-end, cancel-at), existing Checkout return and signature
   tests.
4. **Not verified.** The portal flows themselves.
5. **Files.** `lib/billing/stripe.ts`, `stripe-events.ts`,
   `lib/trpc/routers/billing.ts`.
6. **Migrations.** None.
7. **Authorization.** Owners and admins change; members view.
8. **Automated verification.** Unit tests with Stripe-shaped fixtures.
9. **External dependencies.** Portal flows need Stripe test-mode credentials.
   No test touches live billing.
10. **Status.** Implemented but incomplete (live portal blocked by Stripe
    credentials).

### Install

1. **Required.** Truthful install methods.
2. **Built.** `components/settings/InstallSettings.tsx`: install as a web app
   from the browser (the manifest exists), and a plain statement that there is
   no desktop or mobile app. No download link.
3. **Verified.** Screenshot at both widths.
4. **Missing.** Nothing required.
5. **Files.** `InstallSettings.tsx`.
6. **Migrations.** None.
7. **Authorization.** None.
8. **Automated verification.** Screenshot.
9. **External dependencies.** A Mac app would be a separate signed release; none
   exists.
10. **Status.** Complete and verified.

### Experimental

1. **Required.** A registry with status, entitlement, dependencies and server
   enforcement.
2. **Built.** `services/internal/product/experiments.go`: realistic previews
   (promoted), Substack Notes (unavailable), calendar planning and draft tags
   (experimental). Opt-in per person, a workspace switch for owners and admins,
   and the backend refuses tags and planned dates unless both allow them.
3. **Verified.** Go: refusal without opt-in, refusal when the workspace turns it
   off, a promoted experiment cannot be changed, and the list encodes with no
   nulls. E2E: draft tags turns on and stays on after a reload.
4. **Missing.** Nothing required.
5. **Files.** `experiments.go`, `components/settings/ExperimentalSettings.tsx`,
   `components/drafts/DraftDetails.tsx`.
6. **Migrations.** `user_preference.experiments`,
   `workspace_settings.disabledExperiments`.
7. **Authorization.** Opt-in by the person; workspace switch by owner or admin.
8. **Automated verification.** As above.
9. **External dependencies.** None.
10. **Status.** Complete and verified.

## 3. Social-set management

1. **Required.** List, create, rename, colour, accounts with health, add,
   reconnect, remove, defaults, sharing, delete; same-name sets by ID; team
   creation.
2. **Built.** `social_set` with a composite tenant key and one active account
   per platform; `social_sets.go` (list, create, update with versions, share,
   assign, remove, copy from another workspace, delete with a Danger Zone);
   OAuth that joins the account to the set and returns to it; health from the
   social service; team creation reuses workspaces (`NewTeamSettings.tsx`).
3. **Verified.** Go: same-name sets stay separate; a second account of a
   platform is refused; a private set is its owner's until shared; removal
   cancels the queue and blocks publishing; deletion needs authority and keeps
   the last shared set. E2E: two sets named "Brand" get different IDs and pages.
4. **Not verified.** Live OAuth reconnect with real providers.
5. **Files.** `social_sets.go`, `internal/publishing/oauth.go`,
   `components/settings/social-sets/`.
6. **Migrations.** `20261029090000_settings_platform.sql` (with the backfill).
7. **Authorization.** RFC 043's table, enforced in Go.
8. **Automated verification.** Acceptance 8, 9, 10.
9. **External dependencies.** Live reconnects need each provider's OAuth app.
10. **Status.** Implemented but incomplete (live provider OAuth blocked).

## 4. Scheduling

1. **Required.** Set time zone, weekly grid, 15-minute times, count, natural
   times with an override, preserved instants, DST rules, atomic slots.
2. **Built.** Per-set time zone and slots; a grid of 15-minute times; the queue
   reserves a slot under a per-set advisory lock; DST gaps and repeats resolve by
   RFC 043's rule; natural offsets (±4 minutes) are chosen once, stored with the
   post and replayed on retry; existing posts keep their instants when the grid
   changes.
3. **Verified.** Go: weekdays at two times are ten slots; concurrent queueing
   takes distinct slots; a natural time is stored, replayed and kept when the
   template changes; DST tests. E2E: a new set's five slots become ten after
   adding a second time, in the database and after a reload; the set's time
   zone saves.
4. **Missing.** Nothing required.
5. **Files.** `content_draft_platform.go`, `content_draft_schedule.go`,
   `SchedulingPage.tsx`, `lib/settings/zoned-time.ts`.
6. **Migrations.** Set schedule columns; `scheduled_post` slot, mode, offset
   and zone.
7. **Authorization.** `publish:manage` to change.
8. **Automated verification.** Acceptance 1, 2, 3, 6.
9. **External dependencies.** None.
10. **Status.** Complete and verified.

## 5. New-draft defaults

1. **Required.** Ordered default platforms, primary, sync rule, X engagement
   defaults, snapshot semantics.
2. **Built.** Set defaults (ordered platforms, primary, natural times, X
   auto-retweet and auto-plug); a new draft copies them, and later changes leave
   existing drafts alone. Follow-ups run through the existing X auto-action
   infrastructure.
3. **Verified.** Go: a new draft copies the set's ordered defaults and later
   defaults leave it alone.
4. **Not verified in a browser.** The composer's X options seeded from the set
   (screenshot only).
5. **Files.** `content_drafts.go`, `NewDraftPage.tsx`, `DraftComposer.tsx`.
6. **Migrations.** Set default columns; draft snapshot columns.
7. **Authorization.** `publish:manage`.
8. **Automated verification.** Acceptance 4, 5.
9. **External dependencies.** None.
10. **Status.** Complete and verified (server semantics); the composer seeding
    is covered by screenshot.

## 6. Public profile and Writing Assistant

1. **Required.** A per-set public profile enforced by the server; a Writing
   Assistant with a lifecycle, style guide and samples that refines the brand
   voice, with prompt-injection defences and metering.
2. **Built.** `/p/{slug}` renders only public identity, is dynamic (never
   cached) and 404s when the profile is off or the set is deleted. The Writing
   Assistant (`writing_assistant.go`) has its lifecycle, style guide, up to 20
   samples, precedence over the brand voice (prohibited terms add up), and
   fences samples as data in the prompt; AI calls are metered by AI credits.
3. **Verified.** E2E: an anonymous visitor gets 200 while the profile is on and
   404 after it is turned off. Go: writing context precedence. Unit: a sample
   cannot close the fence it is quoted in.
4. **Not verified.** Handles and avatars on the public page (the e2e social
   mock reports none), and generation quality with a real model.
5. **Files.** `app/[locale]/p/[slug]/page.tsx`, `writing_assistant.go`,
   `lib/content-drafts/assist.ts`, `WritingAssistantPage.tsx`.
6. **Migrations.** Set public columns, `social_set_writing_sample`.
7. **Authorization.** `publish:manage` for the profile; `artifact:edit` for
   writing settings.
8. **Automated verification.** Acceptance 11.
9. **External dependencies.** Real generation needs `OPENROUTER_API_KEY`; tests
   use the scripted model.
10. **Status.** Implemented but incomplete (live model output unverified).

## 7. Integrations, API and webhooks

1. **Required.** Catalogue (Claude, ChatGPT, MCP, Agent Skills, Notion Agents,
   Slack, Zapier, Raycast), API keys, outbound webhooks, development mode, debug
   logging.
2. **Built.** `IntegrationCatalog.tsx` states each entry's real status; there is
   no Connect button without a working flow. API keys show created, expiry, last
   used and status, and revoke behind a confirmation. Outbound webhooks
   (`services/internal/webhooks/`): seven draft events, a versioned envelope,
   HMAC signatures, the outbox, retries to dead letter, replay, SSRF checks,
   delivery history ([consumer guide](../outbound-webhooks.md)). Development
   mode shows IDs with copy; debug logs stay in the browser, redacted and
   bounded, with download and clear.
3. **Verified.** Go `TestOutboundWebhookDelivery` (validation, signature,
   retries to dead, replay with the same event ID, rotation) and
   `webhooks_test.go`. E2E: a private address is refused; the signing secret
   shows once and is gone after a reload. Unit: debug-log redaction and bounds.
4. **Not available.** Zapier and Raycast publish no Shots app (Zapier works
   through webhooks and the API); Notion Agents has no integration; Slack DMs as
   above.
5. **Files.** `WebhookSettings.tsx`, `DeveloperTools.tsx`,
   `WorkspaceDeveloperSettings.tsx`, `lib/debug-log/`.
6. **Migrations.** `webhook_subscription`, `webhook_delivery`,
   `webhook_delivery_attempt`; draft `tags`, `plannedFor`.
7. **Authorization.** Webhooks and keys: owner or admin.
8. **Automated verification.** Acceptance 12, 13.
9. **External dependencies.** `PLATFORM_WEBHOOK_ENCRYPTION_KEY` must be set on
   the backend (production: `TENANT_PLATFORM_WEBHOOK_ENCRYPTION_KEY`); without
   it the API answers 503 and the page says so.
10. **Status.** Implemented but incomplete (third-party apps do not exist).

## 8. Data model

1. **Required.** The spec's entities, with entitlements kept apart.
2. **Built.** `user_preference`, `account_deletion_request`, `social_set`,
   `social_set_writing_sample`, the three webhook tables, and additive columns
   on channels, drafts, posts, OAuth starts, workspace settings and notification
   preferences. Ent schemas match.
3. **Verified.** `platformmigrations` applies every migration to a fresh
   database; `TestEntProjectionsMatchMigratedTables`; the backfill was checked
   against seed data.
4. **Missing.** Nothing required.
5. **Files.** `services/ent/schema/`, `services/platformmigrations/sql/`.
6. **Migrations.** `20261029090000_settings_platform.sql`, additive. Rollback is
   in RFC 043.
7. **Authorization.** n/a.
8. **Automated verification.** As above.
9. **External dependencies.** None.
10. **Status.** Complete and verified.

## 9. Persistence and interaction contract

1. **Required.** Immediate saves with failure feedback and rollback, explicit
   submission for creation, personal state apart from shared state, stable IDs.
2. **Built.** `PreferencesProvider` and `useSaveSocialSet` save at once, show
   saving and saved only after the server answers, and restore the previous
   value on failure; set saves are serialized against the version the last save
   returned. Creation (sets, webhooks, samples) is an explicit submit.
3. **Verified.** E2E: a refused save shows "Not saved" and restores the choice.
   Go: a stale preference or set version is refused.
4. **Missing.** Nothing required.
5. **Files.** `components/settings/PreferencesProvider.tsx`,
   `components/settings/controls.tsx`, `social-sets/api.ts`.
6. **Migrations.** Version columns.
7. **Authorization.** n/a.
8. **Automated verification.** Acceptance 14.
9. **External dependencies.** None.
10. **Status.** Complete and verified.

## 10. Acceptance checks

| #   | Check                                                   | Test                                                                                                                      | Result |
| --- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | Display time zone does not change set time zone         | Go `TestSocialSetsPlatform/the_display_time_zone_is_not_the_set's_time_zone`                                              | Passed |
| 2   | Editing slots keeps scheduled instants                  | Go `…/a_queued_natural_time_is_stored,_replayed_and_kept_when_the_template_changes`                                       | Passed |
| 3   | Two rows Monday to Friday count 10                      | Go `…/weekdays_at_two_times_are_ten_slots`; E2E `social sets keep their own names, schedules…`                            | Passed |
| 4   | New drafts get ordered defaults                         | Go `…/a_new_draft_copies_the_set's_ordered_defaults,_and_later_defaults_leave_it_alone`                                   | Passed |
| 5   | Changing defaults leaves drafts                         | Same as 4                                                                                                                 | Passed |
| 6   | Natural offset stable across reload and retry           | Go `TestNaturalOffsetIsBoundedAndStable`, `…/a_queued_natural_time_is_stored,_replayed…`                                  | Passed |
| 7   | Settings navigation keeps editor content                | E2E `social sets keep their own names, schedules and settings beside the composer`                                        | Passed |
| 8   | Same-name sets addressable                              | Go `…/two_sets_with_the_same_name_stay_separate`; E2E as 7                                                                | Passed |
| 9   | Disconnected accounts guide recovery and cannot publish | Go `…/a_removed_account_cancels_its_queue_and_cannot_publish`, `TestAccountHealth`; attention screenshot                  | Passed |
| 10  | Private-to-team sharing needs authorization             | Go `…/a_private_set_is_its_owner's_until_they_share_it`, `…/deleting_a_set_needs_authority…`                              | Passed |
| 11  | Public profile enforced server-side, including cache    | E2E `a public profile is served only while it is turned on`                                                               | Passed |
| 12  | Webhook validation, signing, retry, deduplication       | Go `TestOutboundWebhookDelivery`, `TestValidateEndpointRefusesUnsafeDestinations`, `TestSignatureAndSealing`; E2E refusal | Passed |
| 13  | API credentials stay secret                             | E2E `a webhook secret shows once, and private addresses are refused`; existing `api-key-releases.spec.ts`                 | Passed |
| 14  | Failed saves do not show as saved                       | E2E `personal settings are addressable…` (refused PATCH); Go version conflicts                                            | Passed |
| 15  | Theme, week start and direction change the UI           | E2E `personal settings…` (theme, week start), `social sets…` (`dir="rtl"`)                                                | Passed |

## 11. Coverage limits and blockers

Verified only with local fixtures. Each item below names its prerequisite.

- **Slack direct messages.** The Slack app must request `im:write` and
  `users:read.email`, and each workspace must reinstall it.
- **Email change confirmation.** Needs a mail transport in each environment.
- **Stripe portal flows.** Need Stripe test-mode credentials; nothing touched
  live billing.
- **Provider OAuth reconnects.** Need each provider's OAuth app.
- **Live model output.** Needs `OPENROUTER_API_KEY`.
- **Zapier, Raycast, Notion Agents, a Mac app.** None exists; the UI says so.
- **Production.** Webhooks need `TENANT_PLATFORM_WEBHOOK_ENCRYPTION_KEY` in
  Infisical before they work; until then the API answers 503.
