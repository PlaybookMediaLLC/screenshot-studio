# Team collaboration capabilities

This implements the capability separation in Teams §5 and acceptance criteria
T10, T12, and T20. It extends the existing organization membership; it does not
create a second membership or approval system.

| Stored role        | Display name    | Write drafts | Approve | Schedule/publish | Manage accounts/sets | Manage members | Manage billing |
| ------------------ | --------------- | ------------ | ------- | ---------------- | -------------------- | -------------- | -------------- |
| `owner`            | Owner           | Yes          | Yes     | Yes              | Yes                  | Yes            | Yes            |
| `admin`            | Admin           | Yes          | Yes     | Yes              | Yes                  | Yes            | No             |
| `creator`          | Write           | Yes          | No      | No               | No                   | No             | No             |
| `approver`         | Approver        | No           | Yes     | No               | No                   | No             | No             |
| `publisher`        | Publisher       | No           | No      | Yes              | No                   | No             | No             |
| `writer_publisher` | Write & Publish | Yes          | No      | Yes              | No                   | No             | No             |
| `viewer`           | Read-only       | No           | No      | No               | No                   | No             | No             |

Every role can read resources visible to that membership. Private social-set
ownership still restricts this access. `member` remains the legacy viewer alias;
unknown roles never acquire writing or decision authority. Scheduling continues
to require the current revision's approval when the workspace requires review.
An edit invalidates that approval. The additive role does not grant approval,
membership administration, account management, or billing authority.

The web permission map and generated API contract expose `writer_publisher`,
`connection:manage`, and `billing:manage`. Go checks the current database role,
session, active workspace, and workspace deletion state. Its shared role matcher
grants the new role the existing creator/publisher capabilities. Collaboration
token creation and subsequent writes use the same mapping and recheck membership.

OAuth begins and callback completion require current owner/admin authority, with
the existing original-attempt/session binding and callback locks preserved.
The HTTP account-creation boundary checks this before invoking a provider. A
publishing role no longer grants account administration. Review decisions require
a human approver/administrator session, separately from authoring and publishing.
Review notifications target approvers; publication notifications include the new
writer/publisher role. Existing recipient and resource privacy checks still run.

Billing checkout, credit purchases, and checkout completion require the explicit
owner-only permission. Delegated admins can still administer content and members;
the Billing page explains that financial changes require the owner. Owner-only
ownership transfer and deletion are unchanged.

## Rollout and rollback

No database migration or new environment variable is required: existing role
columns store strings. Deploy updated backend, collaboration authorization,
notification workers, web, and API clients before inviting or assigning the new
role. Retain existing encryption keys and provider credentials. No credentials
need rotation for this change.

To roll back to a version without `writer_publisher`, first explicitly reassign
those memberships and pending invitations to one supported role chosen by the
workspace owner. There is no single old role with both capabilities; do not map
them to admin. Older readers fail closed on the unknown role. Old code also
restores the prior broader billing/account/review permissions, so retain the
security boundary fixes if rolling back the additive role itself.

## Verification and remaining scope

`test/auth-permissions.test.ts` checks the seven-role capability separation.
`TestTeamCollaborationRoles` exercises real draft reads/edits, collaboration tokens,
review, required approval, scheduling, account authority, demotion, and foreign
workspace denial against PostgreSQL. `TestAccountMutationsRequireAdministrationBeforeProviderCalls`
checks rejection before provider calls. `TestCollaborationNotificationRoles`
checks recipient role selection and Inbox access against stored memberships.

The browser suites are `role-permissions.spec.ts` and
`team-collaboration-roles.spec.ts`; the coverage ledger records their actual
execution results. They use unique accounts, real authentication and persistence,
and the local email sink. They never open Stripe or send public social posts.
The auth helper supports production's separate sign-in and respects explicit
429 responses without retrying unknown registration outcomes.

T10 remains open: read-only/approver commenting still needs a dedicated authorized
mutation path; the current discussion save shares draft-edit authority. T11's
complete acceptance/rejection/replay/revocation/expiry and concurrent seat checks
remain separate work. T12 remains open until all other mutation, media,
collaboration, notification, and delayed execution boundaries have been audited
and tested, including complete membership removal. This increment does not
complete transfers, all provider capabilities, or the full 60-item assignment.
