# Epic AGENT: APIs and external clients

The assignment reopens scoped draft integrations in [RFC 026](../../../rfcs/026-mcp-and-agent-integrations.md). It does **not** authorize API-key draft publication or autonomous approval. The implementation uses the existing Go server, product services and workspace keys.

## WI-AGENT-1: Author and plan drafts through existing MCP

**Source:** TF-088, TF-096, TF-106. **Gap:** Partial tool coverage. [Source requirements](../changelog-features.md).
**Priority:** Reopened. **Size:** M. **Depends on:** Generated OpenAPI contracts, paid draft entitlement, workspace scopes.

### Scope and evidence
`services/internal/social/chat/mcp/drafts.go` exposes draft create/read/update/delete/duplicate/properties/planning/activity, social sets, calendar and best times. `lib/agents/mcp-clients.ts` documents the same 34-tool total. `services/internal/shotsapi/openapi.json` preserves union branch validation while merging path/query fields. `integrations/claude-code/shots/skills/shots/SKILL.md` gives an installable agent workflow; no second MCP server exists.

`draft:write` permits authoring and tentative planning. `artifact:read` permits discovery. API keys never enter private sets. An import key is persisted in `platform_draft_import_receipt` with workspace, actor and payload fingerprint; migration `20261102091000_platform_draft_import.sql` is additive.

### Acceptance criteria
1. Tools visible to a key match its scopes; unknown scopes never grant authority.
2. A repeated creation with the same actor/key and immutable payload returns the same draft, even under concurrent requests.
3. Changed payloads or deleted receipt targets fail explicitly rather than creating another draft.
4. Every edit uses the current version; stale and revoked requests have no side effects.
5. A plan passing its timestamp cannot publish. Keys cannot approve, reject, request changes or schedule content drafts.

### Failure behavior, tests and observability
Conflict means reload/reconcile, never blind overwrite. Unknown create outcomes retain the receipt. Go MCP, PostgreSQL import/concurrency and key-isolation tests exercise canonical services; browser external-client tests read the resulting editable drafts after reload. Existing MCP request logs include operation/scope/result, never key values. Live client directory activation is separate from protocol verification.

## WI-AGENT-2: Import URL text for human review

**Source:** TF-013. **Gap:** Missing review entry and client artifacts. [Source requirements](../changelog-features.md).
**Priority:** Reopened. **Size:** S. **Depends on:** Auth return URL and existing draft creation.

`app/[locale]/page.tsx` routes `?new=` to Write; `lib/write/import-text.ts` and the Write import dialog preserve decoded text and recognized thread delimiters. The author reviews destinations and clicks Create draft. Sign-in preserves the import intent. `integrations/shortcuts/` contains an unsigned native Shortcut source/generator and Raycast Quick Link recipe; no key is placed in the URL.

Acceptance: special characters, percent signs, plus signs, emoji and multiline text survive exactly once; no draft exists before explicit creation; invalid/oversized content stays editable with an error. Browser URL-import tests exercise review, create and refresh. Linux plist validation does not establish Apple import/signing or native Raycast Quick Link behavior; those OS checks remain outstanding. Observe ordinary draft creation/audit events only after confirmation.

## WI-AGENT-3: Deliver lifecycle webhooks to Zapier and other clients

**Source:** TF-024, TF-088. **Gap:** Missing `draft.updated` emission and packaged external workflow. [Source requirements](../changelog-features.md).
**Priority:** Reopened. **Size:** M. **Depends on:** Existing transactional outbox, webhook encryption key and HTTPS destination.

### Changes and scope
`services/internal/webhooks/events.go` defines eight lifecycle events; `services/internal/product/content_draft_write.go` emits `draft.updated` only for changed publication content/title/destinations/options. Status-only and comment-only changes do not masquerade as content updates. The existing dispatcher signs exact bytes, retries with delivery receipts and rechecks privacy before sending. Private set events are excluded at enqueue and delivery.

`integrations/zapier/` is a private Zapier Platform package with eight instant **static webhook** triggers, Create Draft, Find Draft and Plan Draft. An owner/admin configures the subscription in Shots. The receiver checks HMAC, timestamp, event ID and workspace; returned event IDs enable Zapier deduplication. No API key gains webhook administration.

### Acceptance criteria
1. Committed content changes emit one event; failed/no-op writes emit none.
2. Retry keeps the event ID and does not leak bodies, comments or credentials.
3. A queued event becomes undeliverable when its set becomes private.
4. A forged/stale/wrong-workspace webhook cannot run the Zapier action.
5. Draft creation from a source document is retry-safe and remains available for human review.

### Failure behavior and verification
The webhook's failure receipt remains inspectable/retryable in the existing settings UI. The receiver never guesses an envelope when raw bytes are missing. PostgreSQL outbox/privacy tests and the Zapier runtime/signature tests pass locally; the packaged Create Draft action has an actual web/Go/browser regression. Hosted Zaps, downstream Slack/email/calendar actions and public-directory approval remain external checks. Monitor existing delivery status/attempt/error-class fields, not payload bodies.

## WI-AGENT-4: Comment as an identifiable scoped key

**Source:** TF-099, TF-088, TF-106. **Gap:** Missing authorized external comment operations. [Source requirements](../changelog-features.md).
**Priority:** Reopened. **Size:** M. **Depends on:** Separate opt-in `draft:comment`, canonical discussions and version locking.

`services/internal/product/content_draft_comments.go`, REST `/api/v1/content-drafts/{id}/comments`, generated contracts and the two MCP comment tools list/filter threads and add/reply/edit/delete/resolve/delete-thread. Anchors identify a platform and stable `post_break.id`; optional quoted text must occur exactly once in that post. `lib/write/comment-anchors.ts` projects anchors into the existing composer.

Acceptance: server-owned authors display the key's name; a key edits/deletes only its contributions; thread deletion preserves other reviewers' replies; foreign/private/revoked/stale writes fail; comment-only changes preserve content and approval; orphaned anchors remain visible. A second identical action with the stale version conflicts rather than duplicating. Tests cover six concurrent mutations, scope separation, anchoring, author display, resolution filters, reload and key revocation. Audit records distinguish keys from people without fabricating a human actor.

## WI-AGENT-5: Configure future queue slots and resolve mentions

**Source:** TF-096. **Gap:** Missing API-key queue configuration and mention access. [Source requirements](../changelog-features.md).
**Priority:** Reopened. **Size:** M. **Depends on:** Separate `queue:write`, `artifact:read`, provider mention support.

`services/internal/product/social_sets.go` adds `UpdateSocialSetQueue`; REST `/api/v1/social-sets/{id}/queue` and MCP `updateSocialSetQueue` accept only version, zone, slots and natural-time default. Authority and version are locked/rechecked in the transaction. Identity fields and existing publication commands are untouched. `lookupSocialSetMentions` uses the connected account and rechecks visibility after provider lookup.

Acceptance: six simultaneous updates have one winner; invalid/no-op/foreign/private/revoked requests fail; existing planned/scheduled instants and approvals stay unchanged; authorized company lookup returns real URNs rather than invented IDs. PostgreSQL, MCP and browser queue-settings/reload tests exercise these rules. Provider lookup outages return errors and never fall back to another brand. Audit the set update; omit credentials and provider response bodies.

## WI-AGENT-6: Use the Raycast draft client

**Source:** TF-091. **Gap:** Missing native client package. [Source requirements](../changelog-features.md).
**Priority:** Reopened. **Size:** M. **Depends on:** Raycast macOS host for native verification.

`integrations/raycast/` contains Create Draft, Browse Drafts and Queue commands plus four AI tools: create, list, read and **plan**. It remembers set/platform preferences and pending creation receipts. Keys use `X-API-Key`; HTTPS origin validation and redirect refusal keep credentials at the configured deployment. API-key restrictions mean private personal sets and draft publishing are unavailable; this is explicit in the UI/README.

Acceptance: `---` splits a thread; a retry after refresh reuses the same creation receipt; search/duplicate/delete/list delivery outcomes use the canonical API; planned content does not publish; revoked keys stop working. Package tests/build and the actual REST/browser client regression run locally. Native Raycast import and commands, verified publisher handle and directory approval remain outstanding. Error messages preserve retry identity and do not expose keys.
