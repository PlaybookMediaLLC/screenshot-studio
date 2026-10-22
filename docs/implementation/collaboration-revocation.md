# Live collaboration authority

Drafts continue to use the existing Hocuspocus/Yjs service and Go persistence.
The collaboration service has no database credential. Go authorizes each token
against the issuing login session, current user, workspace membership and role,
workspace availability, draft entitlement and resource visibility. Story Set
rooms remain presence-only.

A token is scoped to one user, session, workspace and document. The existing
five-minute admission lifetime remains. The editor obtains a fresh token when
reconnecting. Load/store grace never bypasses a revoked or expired login, a ban,
membership removal or role demotion. Legacy tokens without a session claim must
reconnect. A collaboration store locks membership, session and user authority,
then rechecks it on the transaction connection before updating the stored state.
Concurrent demotion either follows an authorized store or causes the waiting
store to fail. A one-connection pool is supported.

The server rechecks incoming messages before they enter the shared document.
A demoted writer becomes read-only; a delayed older response cannot grant write
access again. A later upgrade requires reconnecting with a fresh token. The
durable store uses the last authorized sync writer's token, not the most recently
joined participant. Writer-token updates finish in `beforeHandleMessage` before
the message is applied: Hocuspocus 3 does not await its `beforeSync` callback.
The shared writer token is changed only when necessary, and failure refuses the
update before it enters the shared document.

Outgoing document updates, presence and stateless messages also require current
authorization. Checking only incoming messages would leave an idle removed reader
subscribed, particularly when another Redis replica broadcasts an update. The
connection's public send method buffers frames while Go checks access. Frames stay
ordered, with at most 256 queued frames and 8 MiB pending per connection; overflow,
authorization failure or an unavailable backend closes that document without
delivering its queued data. Backend requests time out after five seconds. A
protocol close frame contains only a safe explanation and bypasses the data queue.
Each authorization covers only frames queued before that check began. Frames
arriving while it runs require another check; queued and in-flight frames both
count toward the memory bound. Authorization is not cached for a time window,
which could otherwise disclose updates created after removal was acknowledged.
Closing a document can leave the multiplexed WebSocket transport open.

A rejected background store records a safe `collab.store_failed` event and
closes the affected room. It uses Hocuspocus's silent rejection convention so a
debounced error cannot terminate unrelated rooms or emit `collab.stored`.
Reopening requests fresh authority and resubmits retained client Yjs state;
the existing local persistence and canonical REST autosave remain separate.
No failed store is reported as durable collaboration persistence.

This does not erase content that a member already received while authorized.
It prevents new reads and writes after access is denied. Stored document revisions,
canonical content and audit history remain separate from the Yjs transport state.

## Deployment and rollback

No migration or new production setting is required. Retain the existing
`COLLAB_TOKEN_SECRET`, `COLLAB_SERVICE_TOKEN`, `COLLAB_BACKEND_URL`,
`COLLAB_REDIS_URL` and `PLATFORM_COLLAB_URL` configuration. Update the product API
and every collaboration replica together, draining existing rooms so they reconnect
under the new checks. The API rejects sessionless legacy tokens; compatible web
clients request fresh tokens. An old collaboration replica does not enforce the
outgoing-data guard, so a mixed deployment is not the completed revocation fix.
Rolling back the transport code would restore that exposure; retain these checks
when rolling back unrelated presentation changes. Persisted Yjs state stays
compatible and does not require rewriting.

## Verification scope

The coverage ledger records the actual runs. Protocol tests use real Hocuspocus
WebSockets, including two replicas and real Redis. PostgreSQL tests cover session
expiry, bans, workspace switching, role demotion, removal, transaction-time
authorization and a one-connection pool. Browser flows use independent signed-in
members and the actual product API/collaboration service, with persisted-state
assertions. This does not complete the separate media, audit, notifications,
membership-administration and queued-work portions of T12/T16.
