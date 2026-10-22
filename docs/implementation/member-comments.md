# Member comments without document editing

Current human members can add comments, reply, edit their own comments, delete
their own comments, and resolve/reopen discussions on drafts they can read.
Owners/admins can additionally delete another member's comment. Approval,
publishing, account administration, and document editing remain separate.
Private social sets, current membership, session validity, and paid content-draft
access are checked by Go at mutation time. API keys, support, webhooks, and service
actors cannot impersonate a human commenter.

The canonical `content_draft.discussions` JSON remains the only team-comment
store. The existing rich-text editor continues to own anchored authoring. The
read-only composer now has explicit comment controls for viewers, approvers, and
publishers. New whole-draft threads use `scope: draft`; they are not falsely shown
as comments whose anchor text was removed. Guest comments remain separate because
a public feedback link is not team membership.

`POST /api/v1/content-drafts/{id}/comments` accepts a strict discriminated command:
`add`, `edit`, `delete`, or `resolve`. It accepts no author, timestamp, document,
destination, or authorization fields. Go creates canonical text/mention nodes,
resolves mention IDs to current members, and supplies author identities and times.
Deleting the first comment retains other members' replies. A new comment ID cannot
replace a live comment or a deleted comment whose creation event is retained.

A command requires the current `baseVersion`. The transaction locks authority
rows, paid entitlement and the draft, checks visibility again, changes only discussions, and records
its audit and existing comment/mention activity in the same transaction. A stale
or repeated command returns 409 without a second change. Clients reconcile an
uncertain response with a read; the UI never automatically resends a mutation.
Successful lost-response reconciliation recognizes the submitted comment ID.

The draft version advances so an older editor save cannot erase the comment.
If the current publication content was approved, its approved version advances
with the comment-only mutation; unapproved content is never approved by commenting.
There is no document revision or body change. Existing editor writes still use
their optimistic concurrency checks and existing rich-comment validation.

## Rollout

No schema change or new secret is required. Deploy the product API and backend
SDK before the web controls. Existing discussion data remains readable, including
anchored and resolved threads. Rollback removes the new controls/endpoint but keeps
stored comments, activity and audit records. Do not delete these records on rollback.

## Verification

Execution evidence is recorded in the main 60-criterion coverage ledger. The new
Go integration tests cover viewer/approver actions, content and approval stability,
replay, concurrent-version conflict/retry, author protection, deletion with replies,
private/foreign resource denial, invalid mentions, machine actors, and removed sessions.
The commit-time authorization uses the transaction's connection; a one-connection
pool regression guards against waiting for a second connection while holding the first.
The browser flow exercises real authentication and PostgreSQL, including a response
lost only after the real comment commit. External delivery remains in the local
email sink; no public social post or paid action is part of these checks.

T10 still includes the broader collaboration and transfer contract. The
[invitation lifecycle](invitation-lifecycle.md), including decline and atomic
acceptance/seat checks, is now locally verified. T12's complete removal audit remains
separate work. This increment is not verification of the full 60-criterion assignment.
