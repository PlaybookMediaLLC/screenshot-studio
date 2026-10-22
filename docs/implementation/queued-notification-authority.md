# Queued notification authority

Notification projection grants no lasting access. The existing Go maintenance
worker resolves the current recipient, resource and destination before each
delivery attempt. Its final database checks now run after Slack channel discovery
and after the exact encrypted request is persisted.

## Delivery contract

- Email checks current membership, bans, resource visibility, workspace state,
  verified address and preferences. The final check validates the persisted
  request's address and transport; changing the address cannot send the old
  request to its former destination or silently reroute it to the new one.
- Shared Slack delivery rechecks the draft/post's social set when projecting and
  when dispatching. Private, deleted, missing and foreign-workspace social sets
  cannot authorize delivery. Missing draft/post resources are also refused.
- The Slack channel lookup is read-only and runs before the final local checks.
  A privacy change while that request is in flight is observed before sending.
  Retryable channel failures retain their existing retry policy and do not cross
  the send boundary.
- A delivery must still have the worker's claim token and `CLAIMED` status after
  preparation. Removal, disconnect or another worker fencing that claim prevents
  the stale worker from sending, even if current access would otherwise allow it.
- Normal delivery uses the existing stable idempotency key and receipt. No new
  queue, sender, credential or retry engine is introduced. Terminal skipped
  payloads are cleared; immutable domain events and completed receipts remain.

The database's existing membership trigger cancels queued personal deliveries,
removes inbox rows/preferences and fences claimed work. If a claim had crossed
the persisted send boundary, that trigger conservatively records `UNCERTAIN`;
it cannot know whether another process has already entered the provider. This
change does not relabel those outcomes as known failures or automatically retry
them. A request already admitted by the provider cannot be recalled.

Deleted social sets now also redact retained inbox descriptions and disable
their target resolution. Archive/read state remains separate from delivery and
the immutable event. An archived draft that remains readable is not treated as
a deleted resource.

Workspace creation now binds the verified creator as the membership event actor
inside the creation transaction. Its initial owner join remains in activity
history, but does not become a personal notification about the creator's own
manual action. Concurrent creation/retry still produces one attributed event.

## Verification

The real-PostgreSQL regression first reproduced unwanted delivery for a deleted
set, shared Slack events after privacy/deletion changes (including during channel
discovery), and an email address changed between preparation and persistence.
The unchanged email and Slack controls delivered successfully. The final tests
also exercise removal, bans and cancelled claims after payload persistence using
a test-only database trigger, without adding production test hooks. HTTP provider
sinks count actual outbound requests. Membership removal before dispatch is
cancelled by the existing trigger without claiming or sending the delivery.

All tests in `internal/notifications`, `internal/maintenance` and
`internal/temporalmaintenance` passed. The complete notification package passed
with the race detector; full `go vet ./...` passed. Evidence is retained in
`.context/notification-authority-{reproduced,fixed,go,race,vet}.log`.

The initial test setup incorrectly assumed a policy ID column and a draft soft
deletion column, and expected the worker rather than the membership trigger to
cancel pending work. Those fixture assumptions were corrected before recording
the six reproduced delivery failures. No business assertion was weakened.

The production-browser notification journey passed in 48.1 seconds (52.4 seconds
including runner setup), using real authentication, PostgreSQL and Temporal with
local HTTP Slack/email providers. It checks 12 delivered source events, personal
opt-out and disconnect, persistent read/unread/archive/restore, a failed mutation
and explicit retry, cross-tab unread counts, exactly one selected tab, settings
URL preservation/focus return, foreign-workspace refusal and mobile bounds.
Populated Activity, Archive and mobile screenshots were inspected.

The first browser run hit an authentication rate limit because the test repeated
sign-in after the shared helper had already established the session. Those
redundant requests were removed. The next run reached the final workspace check
and exposed the missing creator attribution described above. The concurrent
creation test independently reproduced zero attributed events before the fix.
The final browser run preserves the original empty-foreign-feed assertion and
passes. Browser evidence is `notification-authority-browser-verified.log`; images
are `workspace-notifications.png`, `notification-archive.png` and
`workspace-notifications-mobile.png` in `.context/`.

The final full serial Go run passed all 125 tested packages with no failures.
The first broad run exposed a missing download-grant configuration in MCP's
separate service graph; that configuration and a cross-service revocation
regression were added before the successful rerun. See
[member media revocation](member-media-revocation.md). Full vet, SDK build,
formatting, full lint and cached TypeScript passed. JavaScript tests passed
941 root, nine collaboration tests using real Redis, and 21 editor tests, with
no failures or skips. CodeRabbit reviewed all 11 source/test/feature-document
files and reported zero findings. Subsequent coverage/PR prose was reviewed
locally. No production TypeScript changed, so the existing successful production
build was retained for the browser scenario rather than rebuilt.

Final logs are `.context/notification-authority-{go-all-final,vet-final,
format-full,lint-full,sdk,types,unit,review-final}.log`. This checkpoint verifies
N01, N02 and N07 locally; N03 still needs controlled delayed-response tests, N05
needs source social-set attribution and the remaining event matrix, and N06
needs explicit retention policy and tests.

## Rollout and remaining scope

Deploy the updated Go API (for inbox/resolve reads) and every maintenance worker
(for delivery). There is no migration, new environment variable, SDK contract or
web build requirement. Existing pending jobs are rechecked when consumed. Old
workers must drain or stop before claiming the changed delivery guarantees.
Rolling back restores the identified authorization gaps; retain the new checks.

This covers queued notification and stale deleted-set reads. It does not complete
the separate SCIM/provisioning capacity audit, scheduled-publication authority,
personal Slack DM implementation, all notification preferences, or the complete
T12/T16/N15 acceptance matrices. Local HTTP fixtures prove the protocol boundary,
not delivery to a live Slack workspace or email provider.
