# Notification source context and feed isolation

Notifications now identify their source social set as well as their workspace.
The source is captured on the existing canonical outbox event when its business
transaction commits. Receipt IDs, event IDs, delivery history and read/archive
state retain their existing relationships. No separate event or notification
store is introduced.

## Source and authorization contract

`outbox_event.notification_social_set_id` is an immutable, content-free reference.
A database trigger resolves it from the event's tenant-scoped draft, scheduled
post, channel connection or social set. Both Go and SQL emitters use the same
capture boundary. Caller-provided source values are replaced by that lookup.
Changing a draft's destination later cannot rewrite the event's provenance.
Names are looked up when rendering, after current authorization; duplicate names
never identify the record. Renaming a source updates its visible name without
rewriting history.

Projection, personal delivery, shared Slack delivery, feed reads and target
resolution check both the original source and the current target. A readable
destination cannot reveal an event whose original source is now private,
deleted, missing or outside the workspace. Its retained receipt shows the safe
unavailable message with no source ID, source name or destination link. Existing
recipient read/archive state remains intact. Personal per-set opt-outs also apply
to both source and destination. Shared Slack never receives a private-source
event, including after a resource move.

Connection activity uses the same social-set privacy boundary. Being a workspace
owner or administrator does not confer access to another member's private
connection events. A removed connection resolves as unavailable. The existing
rules for who receives connection events and who can administer connections are
otherwise preserved.

## Feed behavior

The browser keeps queries scoped to person, workspace and selected tab. A real
response arriving after a tab or workspace change cannot populate the new feed.
Tab selection remains session-scoped. The new tests hold authorized server reads
before delivery and switch the visible scope while the responses are outstanding.

Loading, a completed empty result, failed reads and permission denial have distinct
messages. A gateway error with a non-JSON response uses a readable retry message.
The browser does not automatically retry 401/403/404 reads; transient read failures
have two retries and explicit manual recovery. Opening a stale row revalidates
the target, reports unavailability and stays on the current page. Rows render
source identity, workspace, timestamp and persistent read/archive controls.

## Migration and rollout

Apply `20261101100000_notification_source_context.sql` before deploying the updated
Go readers/writers and maintenance workers. It adds one constant-default text
column and one trigger; existing events remain unchanged and their unknown
historical source stays blank. Backfilling from a resource's current destination
would manufacture historical attribution and is deliberately not done. There is
no new foreign key: deleting a set must not cascade into event or delivery history.
The migration replay preserves existing read/archive state and source references.

The database needs its normal brief schema lock for the additive column/trigger;
there is no data backfill. Reads use existing event/resource primary keys and
tenant predicates. Older writers remain compatible and acquire source capture
through the trigger. Older readers ignore the extra column/JSON property; new
SDK readers accept an absent `sourceSocialSet` during a mixed deployment. Update
all Go API and maintenance replicas before claiming the source-authorization
guarantees. The web can then show the additive source field.

For rollback, retain the column, trigger and captured provenance. Older readers
can run against that schema, but restore the privacy fixes before making the same
access guarantees. Do not drop the column while any updated Ent reader is active.
No secret, provider permission, entitlement or public posting action is required.

## Verification scope

The PostgreSQL source tests cover duplicate names, capture before delayed
projection, draft moves, live renames, immutable provenance, private/deleted or
foreign sources, stale links, queued sends and private connection activity. The
upgrade test starts from the preceding schema, retains historical archived/read
receipts, captures a new event's source and replays all migrations.

The browser fixture creates real users, two workspaces, two same-name sets,
drafts, comments, mentions and a source connection through product APIs. Real
Temporal processing projects notifications. SQL assertions verify the stored
source IDs; visible rows show both sets independently. It covers held-response
tab/workspace races, a non-JSON gateway failure after a real authorized read,
real scope-denial responses, explicit retries, reload persistence, mobile bounds,
and a stale row after the draft is deleted through the API. It does not mock
authentication, authorization, event projection or storage.

Historical events without source capture still have the existing current-target
authorization checks and workspace context. The new field does not reconstruct
their missing history. Cross-workspace social-set transfers, personal Slack DMs,
notification retention and the remaining event policy matrix are separate open
requirements. Protocol sinks are not live Slack/email delivery evidence.

## Executed evidence — 2026-10-22

- All 125 tested Go packages passed in the final serial run with `GOMAXPROCS=2`;
  full `go vet ./...` passed. The notification package passed with the race
  detector (18.731s). A fresh-database upgrade/replay test passed in 1.858s.
- SDK build, API artifact generation, full formatting/lint, normal TypeScript,
  production build and RFC verification (17/17) passed. JavaScript passed
  941 root, nine collaboration tests with real Redis, and 21 editor tests,
  with zero skips. Changed-file formatting passed again after the final test edit.
- The initial populated-feed browser scenario passed (3.8m). Its expanded
  version, adding stale-resource navigation/redaction, passed in 28.3s.
  The unchanged delivery/lifecycle scenario passed on a focused rerun (1.2m).
  This is two distinct passing scenarios across runs, not one clean combined run.
- Desktop and mobile populated Inbox screenshots and the unavailable-source
  screenshot were inspected. CodeRabbit reviewed all 21 source/test/generated/
  feature-document files and reported zero findings; later ledger/PR and
  execution-result prose was reviewed locally.

The first connection-privacy test omitted a required fixture `secretReference`;
it was corrected with a non-credential test value. The first broad Go run hit
database handshake timeouts in onboarding and was stopped. TypeScript/lint were
also interrupted during that period and passed on rerun. A combined browser run
passed the new scenario but timed out in the existing delivery scenario while
the backend recorded a policy save taking 90.74 seconds. Its original assertions
were unchanged on the passing focused rerun. Local Temporal logs also record
heartbeat/poll timeouts during the slow periods. No single root cause is claimed.

Evidence is retained in `.context/notification-source-{go-final,go-all-final,
race,vet,upgrade,sdk,api-generate,format,types-final,lint-final,unit,build,rfcs,
browser,browser-final,lifecycle-rerun,review}.log`. Screenshots are
`notification-inbox-sources.png`, `notification-inbox-sources-mobile.png` and
`notification-unavailable-source.png`. The normal Playwright runner used the
isolated fixture wrapper; full `make e2e` remains outstanding. The authorized X
fixture was retained and no live social post, provider authorization, purchase
or production deployment was performed.
