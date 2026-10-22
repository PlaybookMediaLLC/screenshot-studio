# Workspace creation and recovery

## Canonical creation

The Go `CreateWorkspace` service commits the organization, owner membership,
default settings, audit event, optional active-workspace change, and creation
receipt in one transaction. It verifies a current session and rejects machine
actors. A user-row lock serializes creation across that user's sessions; the
session is locked and revalidated before any write.

Both `workspace.create` and Better Auth's `/api/auth/organization/create` now use
this service. The organization plugin retains its normal router, origin, and
session protections. Its replacement creation endpoint also covers server calls
through `auth.api.createOrganization`; callers cannot supply another user's ID
or bypass authentication. The response includes the actual persisted membership
ID, current role, organization metadata, and creation dates. HTTP dates remain
ISO strings; Better Auth's direct server response retains Date values. There is
no second organization store or duplicate creation hook/audit.

The receipt retains an immutable result organization ID, actor ID, request key,
SHA-256 input fingerprint, and creation time. Reusing a key with different details
conflicts. Successful replay returns the same organization, including its current
name and membership role, only while the actor remains a member of an operational
workspace. Replay does not reactivate it or append another owner or audit event.
A deleted workspace's receipt remains a tombstone. User deletion cascades receipts.

Legacy callers without a key use an actor-scoped original-slug receipt. These
receipts do not expire: a late retry must not create another workspace after a
rename or purge. Intentionally reusing an old slug requires a fresh explicit key.
Previously submitted raw names remain unchanged during retries, and the service
recognizes fingerprints created before the NFC name policy.

## Name and metadata policy

Names are trimmed using Unicode White_Space plus BOM, then normalized to NFC.
They must contain 2–100 Unicode scalar values after normalization, with at least
one visible non-mark character. Empty, whitespace-only, combining-mark-only,
malformed UTF, replacement characters, controls, and directional/other formatting
characters are rejected. ZWNJ and ZWJ remain allowed for international text and
emoji. The limit counts scalar values rather than grapheme clusters or UTF-16
code units. Go and Zod use the same 25-case test corpus.

Display names may repeat. Separate creation requests receive independent UUID
keys and slugs; names never establish ownership, authorization, or deduplication.
Creation logo references are bounded HTTP(S) URLs without embedded credentials.
Optional metadata is bounded to three container levels and 8 KiB, using the same
JSON escaping budget as Go. These limits are validated before persistence.

## Dialog and recovery

The account menu and New Team settings open the same accessible dialog over the
current page. It explains collaboration, links to team roles, identifies the
owner, focuses the name field, and restores focus on dismissal. Cancel/Escape
before submission clears unsaved form text and sends no creation request. Existing
page edits and the active workspace remain intact.

A submitted intent contains its name, slug, UUID key, and
`keepCurrentActiveOrganization: true`. It is retained in actor-scoped,
tab-local sessionStorage before sending, so closing/reloading can retry the exact
request. Submitted names are read-only until resolved. There is a 30-second
request deadline and a pending-submit guard. Network/abort/5xx outcomes retain
retry-only recovery; definite 400/403/409 rejections expose an explicit discard
with a warning to inspect existing workspaces. Unreadable saved intents also
require explicit discard instead of silently creating another request. No
credentials are stored in this intent. Onboarding keeps its existing activation
behavior and in-memory retry key; reload recovery is provided by the team dialog.

Success offers Connect social accounts, Invite members, Choose a plan, and Stay
on this page. Only a chosen next step activates the new workspace. Account-menu
options refresh when opened so a workspace created through Settings is selectable.
Each workspace retains independent billing; creation never clones another paid
subscription. Move a personal social set is clearly disabled until the transfer
workflow is implemented, so T07 remains **In progress**.

## Migration and rollout

Apply `20261101090000_platform_workspace_creation.sql` before the product API.
It adds unique `(userId, requestKey)` and organization indexes without changing
existing organizations. There is no organization foreign key because tombstones
must survive physical deletion. The user foreign key cascades for account deletion.
Existing records remain in the canonical Better Auth tables. This dialog/plugin
increment introduces no further DDL.

Deploy the updated product API before the web/SDK: creation responses now include
validated organization dates, metadata, and the real membership. Older clients
can ignore the added fields. Keep the additive receipt table when rolling back;
dropping it discards retry history and is unsafe while clients can replay old
requests. Prefer a forward fix. No production migration or deployment was performed.

## Verification

The database tests cover concurrent cross-session submissions, preservation of
active context, duplicate names, independent billing, injected owner/receipt
write failures, expired or invalid authority, rename/revocation/deletion replay,
actor-scoped keys, legacy normalization fingerprints, metadata bounds, and the
actual membership role on replay. Fresh and representative-upgrade migration
coverage preserves organization tombstones and user-deletion cleanup.

Local checks passed: all 124 tested Go packages (`go test -p 1 ./...`), full vet,
focused race checks, 934 root JavaScript tests plus workspace suites, direct
Better Auth server-call validation, SDK build, TypeScript, lint, formatting,
RFC checks, and production build. After review fixes, 30 focused JavaScript
checks and TypeScript/lint passed. The existing opt-in Redis collaboration
replication test was skipped in the workspace JS suite; broader collaboration
verification remains open. CodeRabbit reviewed all 26 source/test files;
both valid findings (slug truncation and terminal-error recovery) were fixed.

Production-browser evidence uses real authentication, Go services, and migrated
PostgreSQL:

- `workspace-creation-auth.spec.ts`: anonymous, untrusted/null/missing origin,
  and spoofed-user rejection; concurrent Better Auth requests return one real
  organization/member/receipt/audit, preserve active context, and reject changed
  replay input. The returned workspace opens with one visible owner. Passed 2.1s.
- `workspace-creation-retry.spec.ts`: real commit with only its response dropped;
  close/reload retries the same request, keeps one owner/audit, and activates only
  through the explicit Invite action. A real 409 permits discard without another
  workspace. Passed 3.3s.
- `workspace-creation-dialog.spec.ts`: current-page edits, cancellation, Escape,
  focus restoration, mobile Unicode validation/creation, unchanged active context,
  refreshed account menu, and unreadable-intent discard. Passed 3.8s.

Initial dialog-test failures were a wrong General-settings URL and an unscoped
launcher locator during the account-menu exit animation. Tests now use the real
`/workspace` route, scope the settings launcher to main, and wait for the menu to
close. No authentication, business logic, or assertions were weakened. A stale
TypeScript incremental cache caused a compiler crash; clean diagnostics and a
normal typecheck passed after removing generated cache files.

Logs are retained under `.context/team-dialog-*`. Populated desktop/mobile,
recovery, next-step, and conflict screenshots were inspected. T01–T06 are locally
verified; T07's transfer action and the rest of the 60-criterion assignment remain
open in the coverage ledger. Live X evidence is recorded separately in
[x-live-connection-check.md](x-live-connection-check.md).
