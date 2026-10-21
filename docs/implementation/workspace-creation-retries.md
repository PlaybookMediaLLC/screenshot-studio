# Workspace creation retries

The canonical Go `CreateWorkspace` service now commits the organization, owner
membership, default settings, audit event, optional active-workspace change, and
creation receipt in one transaction. It independently verifies a current session
and rejects machine actors. A user-row lock serializes creation across that user's
sessions; the session is locked and revalidated before any write.

Browser callers supply an `idempotencyKey` UUID and keep it, the name, and the slug
for an unchanged retry. Onboarding and New Team settings retain the request in
memory and prevent overlapping submits. This does not yet recover an attempt
after a browser reload. Older canonical-service clients without a key use an
actor-scoped original-slug receipt. Names may repeat with distinct request keys
and slugs; names never establish ownership or deduplication.
Legacy receipts do not expire: a late retry must not create another workspace
after a rename or purge. Intentionally reusing an old slug requires a fresh
explicit key. Code review suggested a short legacy expiry; it was declined
because discarding the receipt would break that guarantee.

The receipt stores an immutable result organization ID, actor ID, request key,
SHA-256 input fingerprint, and creation time. A key reused with different details
conflicts. A successful replay returns the same organization, including its
current name after a rename, only while the actor remains a member of an
operational workspace. Replay does not reactivate it, append another audit event,
or create another owner. A deleted workspace's receipt remains a tombstone.
Deleting the user cascades their receipts.

`keepCurrentActiveOrganization: true` lets a future creation dialog leave the
current editor context intact. The existing onboarding and settings flows retain
their activation behavior. New workspaces retain the existing independent billing
policy: creation does not clone another workspace's paid subscription.

## Remaining team work

T06 remains **In progress**. Better Auth's separate
`/api/auth/organization/create` path still uses its nontransactional adapter and
must be routed through the canonical service while retaining its origin, session,
and response contract. This increment does not claim atomicity for that path.
The creation modal, cancellation and focus restoration, Unicode name policy,
reload recovery, and empty-team onboarding remain part of T01–T07.

## Migration and rollback

Apply `20261101090000_platform_workspace_creation.sql` before deploying the new
product API. It adds a table with unique `(userId, requestKey)` and organization
indexes; it does not backfill or mutate existing organizations. There is no
organization foreign key because tombstones must survive physical deletion.
The user foreign key cascades for account deletion. Existing records stay in the
canonical Better Auth identity tables.

Rolling back application binaries can leave this additive table in place.
Dropping it discards committed retry history and is unsafe while any client can
retry those requests. Prefer a forward fix; do not replay unknown outcomes after
discarding receipts. No production migration has been applied.

## Verification

`workspace_creation_test.go` covers eight cases: input validation, eight concurrent
submissions across two sessions, context preservation and duplicate names,
independent billing, owner-write rollback, receipt-write rollback, invalid or
expired authority, rename/revocation/deletion replay, and actor-scoped keys.

The fresh-database migration test applies the complete schema, reconstructs the
pre-upgrade state with an existing owner, reapplies the migration, and verifies
replay, organization tombstones, and user-deletion cleanup. Browser coverage in
`workspace-creation-retry.spec.ts` commits through the real backend, drops the
response, retries through the visible form, and checks exactly one owner and
creation audit. Execution evidence is recorded in the coverage ledger.

Final local verification passed: eight focused Go cases and their race run,
all 124 tested Go packages (`-p 1`) and vet, 907 root JavaScript tests plus
workspace suites, SDK build, TypeScript, lint, format, RFC checks, and the
production build. The production browser recovery scenario passed in 4.1s;
the existing onboarding scenario passed against development in 23.7s.
Initial browser failures came from using the development auto-sign-in helper
against production and expecting a billing redirect where workspace settings
remain accessible. The recovery test now explicitly signs in and verifies
the Members page plus durable owner and audit counts. Authentication and
the backend were exercised throughout. Screenshots were inspected.
