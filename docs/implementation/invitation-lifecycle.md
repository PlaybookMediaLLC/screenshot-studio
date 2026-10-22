# Canonical invitation lifecycle

Better Auth remains the identity/router layer. Its create, accept, reject, cancel
and get invitation endpoints delegate to the existing Go product service, including
`auth.api` server calls. Existing workspace invitation/resend/revoke controls use
the same service. No invitation, membership, or delivery engine is duplicated.
The original email-bound opaque invitation ID remains the single-use link.

Creation and resend recheck the current owner/admin session. Creation reserves a
seat including pending, unexpired invitations. Creation, acceptance, decline,
resend, cancellation and billing capacity commitments serialize on the original
organization row. Acceptance rechecks current members against the current paid
limit; a plan downgrade can refuse admission without consuming the invitation.
Other provisioning paths such as SCIM/direct add-member still need mixed-path
concurrency verification; this does not assert that all membership writers use
this invitation transaction.

Acceptance/decline require a live human session and the stored recipient email.
The backend reads the current user, including verification and ban state. A wrong
recipient receives no invitation metadata. Acceptance additionally requires the
inviter to remain an owner/admin and validates the stored role; legacy `member`
is admitted as `viewer`. Owner or unknown invitation roles never grant membership.
Session, user identity and inviter authority rows remain locked through commitment.
The destination comes from the durable invitation, independent of the browser's
selected workspace. A single transaction updates the invitation, creates the
membership, selects the destination on the accepting session, and records audit
and one canonical membership activity event. A failed final write rolls all back.

Accepted, declined, revoked and expired links remain distinguishable to their
recipient. Reusing a consumed invitation returns a conflict and never grants
another membership. Expiry is effective from its stored timestamp even before
maintenance materializes `expired`. A decline neither creates membership nor
changes the active workspace. Administrative cancellation cannot change an already
accepted invitation into a revoked one.

The recipient page displays the actual workspace and role, with separate Accept
and Decline controls. After an uncertain response both are disabled until the
recipient explicitly refreshes status. A committed acceptance can then open the
workspace using a fresh membership check. The browser never automatically retries
the mutation. Better Auth's revived dates are normalized before rendering; raw
schema diagnostics are not displayed.

Invitation email remains post-commit through the existing backend mail transport.
A delivery failure is logged and the pending invitation remains available for an
explicit resend; it does not undo the saved invitation. This change does not add a
transactional email outbox or claim automatic delivery retries.

## Deployment and rollback

No migration or new encryption key is required. Deploy the product API and backend
SDK before the web endpoint overrides. Set the existing
`AUTH_REQUIRE_EMAIL_VERIFICATION` consistently on web and product API. Go requires
verification by default; the explicit `false` setting is used by disposable tests
and the generated local development environment. Retain existing auth mail settings.
Do not silently loosen production verification to work around a configuration mismatch.

Old invitation rows remain valid, including legacy viewer aliases. Rollback keeps
canonical accepted/rejected/canceled rows, memberships and audit/activity. Rolling
back the web to its former adapter writes would restore the separated acceptance
writes and preflight-only seat checks; retain the canonical endpoints during a
rollback of presentation changes.

## Evidence

The coverage ledger records executed checks and remaining gaps. New tests cover
recipient binding, explicit decline, expiry/revoke/reuse, final-write rollback,
concurrent final-seat acceptance, competing accept/decline, concurrent invitation
reservation, bans, verification, expired sessions, inviter demotion, and machine
actor rejection. Browser tests retain real authentication and PostgreSQL and drop
only a response after the acceptance has actually committed. Email delivery is
checked in the configured local sink, separate from a provider delivery claim.
