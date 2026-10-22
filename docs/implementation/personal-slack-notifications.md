# Personal Slack notifications

Personal Slack direct messages belong to the signed-in member in the current
Shots workspace. A separate `platform_slack_personal_connection` maps that member
to Slack's authorizing user and the existing encrypted bot installation. Shared
workspace channels continue to use `platform_slack_connection` and workspace
policy. A member can neither configure nor disconnect another member's DMs.
Personal connections never become publishing credentials or shared channel choices.

## Provider contract

The existing OAuth start/callback flow accepts a `personal` purpose, requests
only the bot `chat:write` scope, and binds state to organization, user and session.
The backend uses `authed_user.id` from the
[OAuth response](https://docs.slack.dev/reference/methods/oauth.v2.access/) and
checks the bot token's workspace through `auth.test`. It does not accept a
destination ID from the browser. Missing identity or permissions fail closed.
Reconnect requires the same Slack app, workspace and user. Selecting another
account requires disconnecting first. Current membership and session are locked
again after provider calls and through commit.

Slack documents sending to a user's App Home conversation by passing their user
ID to [`chat.postMessage` with `chat:write`](https://docs.slack.dev/reference/methods/chat.postMessage/#begin-a-conversation-in-a-users-app-home).
The response must contain a DM conversation ID and timestamp. No `im:write`,
user directory scope, user token, or guessed provider endpoint is needed.
Slack workspace installation policies can still require administrator approval.
Installations shared with channel delivery retain their existing scopes; a grant
that would reduce those scopes is rejected without replacing stored credentials.

## Delivery and privacy

DM event preferences default off. `preferences.events[kind].slack` now means the
member's DM preference; `policy.events[kind].slack` remains the shared-channel
rule. Workspace `availability.slack` gates both. Email's master switch does not
disable DMs. Existing per-set opt-outs apply to all personal channels; independent
per-channel set controls remain tracked under N08–N10.

The existing outbox fanout and delivery worker create `slack_dm` rows using the
Shots member ID as destination and the personal connection ID as a fence. The
unique event/channel/destination key prevents duplicate fanout. Current resource
and original social-set access, membership, preferences, policy generation and
connection identity are checked before sending. Token rotation reuses the existing
installation claim mechanism; authority is checked again after rotation.

Only the recipient can inspect their DM receipt. Workspace delivery lists and
administrative recovery exclude these private receipts. Test messages are explicit,
idempotent and rate limited. Delivery uses existing pacing; provider rate limits
defer retries. An ambiguous write stays `UNCERTAIN` without automatic replay.
Recipient-facing recovery of ordinary failed DMs is still tracked under N13–N14;
this increment does not expose an administrator retry control for private messages.

Disconnect only removes the member's destination and audits the change. It never
calls Slack `auth.revoke`. Membership deletion cascades through `member_id`,
including SCIM/database membership removals. A trigger fences pending/blocked
work and clears claims and encrypted payloads; an in-flight send is conservatively
marked uncertain. Rejoining cannot revive the old connection. Installations remain
while any shared or personal connection references them, and health maintenance
also checks installations used only for DMs.

## Migration and rollout

`20261101110000_personal_slack_connections.sql` adds the member-owned mapping,
tenant/user uniqueness, installation lookup index and removal trigger, and expands
the existing delivery-channel constraint. There is no credential backfill and no
new environment variable. Existing shared installation encryption, OAuth callback
configuration and worker registration are reused. New rows contain only IDs and
timestamps; credentials stay in the existing encrypted installation field.

Apply the migration first, update the API and **all notification workers**, then
deploy the web/SDK that exposes personal Slack. Older workers do not understand
`slack_dm`; do not allow mixed old/new worker dispatch after enabling the UI.
The table's foreign key also prevents an older maintenance binary from deleting a
personal-only installation, but that older maintenance operation would fail.

Rollback the web first and retain the compatible Go workers and schema. Prefer a
forward fix. A full binary rollback needs a compatibility change and a deliberate
decision for outstanding private deliveries; do not drop mappings, revoke shared
tokens, or silently rewrite private destinations into channel destinations.

## Evidence

Backend tests cover non-admin OAuth, wrong user/session, single-use state, wrong
identity reconnect, revocation during provider calls, minimal scopes, safe shared
scope preservation, private receipt access, duplicate fanout/test requests,
disconnect/membership/configuration fences, and ambiguous delivery. A separate
fresh-database upgrade/replay test verifies retained shared history and cancellation
of pending/in-flight DMs when membership is removed.

`test/e2e/personal-slack.spec.ts` uses real auth, invitations, creator permissions,
API, Postgres and Temporal with a local Slack protocol fixture. It checks distinct
personal/shared configuration, per-event preferences, a delivered DM receipt,
reload persistence, owner rejection and personal disconnect with the shared
connection preserved. This is local protocol/integration evidence; live Slack
account authorization, live DM delivery and production rollout are not claimed.

Execution on 2026-10-22: the new browser scenario passed in 8.9s and the unchanged
workspace notification scenario in 40.2s (2 passed, 51.5s total). All 125 tested Go packages,
full `go vet`, the notification race suite (8.899s), the dedicated fresh upgrade
(9.30s), SDK/API generation, full format/lint, normal typecheck, production build,
RFC checks and JavaScript tests passed. JavaScript totals were 941 root,
9 collaboration with real Redis, and 21 editor tests, with zero skips/failures.
Early fixture assumptions and the personal reconnect lookup were corrected;
one intermediate existing mark-all test deadline failure passed unchanged on the
final full-package run. The reviewed personal-test error now distinguishes
"connect" from "reconnect" and is covered by the final race suite.

Final CodeRabbit review completed with zero findings across 42 files; the final
SDK comment and execution-evidence prose were also reviewed locally.
