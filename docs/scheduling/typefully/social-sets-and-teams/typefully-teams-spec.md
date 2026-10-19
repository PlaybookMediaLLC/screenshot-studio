# Typefully Create New Team — functional reverse engineering

Inspected October 13, 2026. **LIVE** denotes direct application observation; **DOC** denotes official written guidance; **PUBLIC** denotes the rendered pricing page; **PROPOSED** denotes a design recommendation.

No team was created, no invitation sent or generated, no social set moved, and no role or billing setting changed. The available account had personal sets and no eligible team destination. Post-creation management is consequently documented from official sources and marked accordingly.

## 1. What a team controls

Team creation establishes a collaboration scope. It is distinct from connecting a social provider, naming a social set, enabling a draft's public feedback link, or selecting a billing plan.

**LIVE:** The creation dialog describes sharing social sets with colleagues or clients for writing, reviewing, and scheduling. The personal-set ownership screen explains that moving into a team makes collaboration possible. These surfaces support a model in which the team owns a group of sets and users gain access through membership and role.

The current interface offered Create new team in the main sidebar and New team in settings. There was no requirement to leave Analyze before opening the dialog.

## 2. Creation form

**LIVE:** The centered modal is headed Create Team. Its contents are:

| Element | Observed contract |
|---|---|
| Description | Explains social-set sharing and collaboration |
| Learn more | Links to the official collaboration guide |
| Name input | Placeholder: Team, project, or client name |
| Primary button | Create team |
| Dismissal | Close icon/control |

The input receives focus. An empty field disables Create team. No image upload, email list, permission picker, social-set selector, Slack option, or plan selector appeared in this initial modal.

The input did not expose an HTML maxlength or required attribute in the inspected DOM. That observation is about markup only; application-level and server-side validation may still exist.

## 3. Validation experiment

Only unsaved form input was changed:

| Input | Button state |
|---|---|
| Empty | Disabled |
| Three spaces | Enabled |
| Ordinary nonempty test name | Enabled |

The field was then cleared and the modal closed. The create action was never pressed.

This establishes a frontend readiness weakness: whitespace is sufficient to enable submission. It does not establish that the server accepts a blank-looking team, that creation would succeed, or that the name is stored untrimmed.

**PROPOSED:** Trim before validating, display a helpful name error, and enforce the same rule server-side. Decide explicitly on maximum length, Unicode, duplicate names, and normalization. Do not assume a missing maxlength means unlimited valid team names.

## 4. Creation success and next steps: evidence boundary

The following were not observed: success toast, new-team sidebar placement, default creator role, next-screen selection, empty-team onboarding, invitation form layout, team settings sections, rename controls, deletion flow, and quota errors.

The product description makes their overall purpose clear, but a screenshot-accurate reconstruction of those screens needs an existing team or a disposable test account. This inspection does not invent those layouts.

**PROPOSED creation flow:** validate name → check entitlement → create team atomically → create owner membership → render an empty-team state with distinct actions to add accounts, move existing sets, and invite members. These are recommended implementation steps, not recovered Typefully requests.

## 5. Official collaboration contract

**DOC:** Invitations can use email or single-use links. Permissions can be assigned during invitation and changed later. The documented roles are:

| Role | Documented capability |
|---|---|
| Read-only | View drafts, calendar, analytics |
| Write | Create and edit drafts |
| Write & Publish | Schedule and publish |
| Admin | Manage collaborators and add/move sets |

Invited users can register with Google, X, email, or LinkedIn; accepted invites lead to shared drafts, with admins guided into account connection. Free-account collaborators can join a paid team. Simultaneous editing locks a draft for other users. Transfers include drafts, analytics, and schedules, require owner/admin authority, and present confirmation with a draft count; moving to a free-plan user can unschedule content. [Collaborating in Teams](https://support.typefully.com/en/articles/8717333-collaborating-in-teams)

This contract was not exercised with multiple users. “Write & Publish” and “Admin” should not be treated as a complete machine-readable permission hierarchy: the help table summarizes roles rather than specifying every inherited permission or special case.

## 6. Moving a personal social set

**LIVE:** X Oppulence → General → Ownership and Sharing showed a private ownership explanation and Move to team. The resulting modal was titled Move Social Set and Drafts, with a search field and role-dependent access explanation.

There were no eligible destinations. The UI required being a team owner or admin to move this set. Thus the flow was inspectable only through its destination-selection stage.

A implementation should model this as an ownership operation, rather than creating an extra membership link while leaving the previous owner in control. Before committing, resolve the impact on drafts, schedules, accounts, access, and plan restrictions. The exact confirmation UI, actor's retained access, transactional behavior, and rollback were not observed.

## 7. Team permissions versus public draft feedback

**LIVE:** The sample personal draft's Share & Collaborate dialog offered Public link, off, with an explanation that link holders could view and comment. Internal link had a Copy link action and said Only you can access.

This is a separate sharing channel from team membership. A public feedback link should not be modeled as a team invitation, and a copied internal link should not be assumed to grant access. Neither sharing control was changed or copied during this task.

The notification consequences of comments and mentions are covered in the [Inbox/Activity specification](typefully-inbox-activity-spec.md).

## 8. Current plan evidence and contradictions

**PUBLIC:** The live [pricing page](https://typefully.com/pricing), with Yearly billing selected, displayed:

| Plan | Monthly equivalent shown | Social sets | Team allowance shown |
|---|---:|---:|---|
| Free | $0 | 1 | No teams in comparison table |
| Creator | $12.50 | 20 | No teams in comparison table |
| Team | $29 | 20 | 2 |
| Agency | $79 | 50 | Card says unlimited; comparison table says 50 |

Team and Agency showed unlimited members, permissions, and Slack channel notifications. These are annual-billing display figures, not a checkout quote. The Agency limit conflict was visually confirmed within the same page.

The collaboration guide refers to Business and “legacy Team or Agency,” which conflicts with the current plan names. The guide's naming should not override the current pricing UI. Enforced server entitlements were not tested.

Do not hardcode a team quota from this contradictory evidence. A comparable implementation should use a central entitlement source for both marketing display and server enforcement. Existing legacy subscriptions may also differ from current public plans; the user's entitlement was not inferred from account count.

## 9. Collaboration event surfaces

A team does not have just one generic “activity” feature. The inspected product separates:

- A global notification popover with Inbox, Activity, Archive.
- Notification-delivery preferences, including account-specific publishing events.
- A draft-specific Activity timeline in Draft Properties.
- Comments and public-feedback sharing.
- Slack integration surfaces described in official documentation.

The implementation should keep event history, delivery state, and access control separate. An audit event may remain relevant after a user archives its notification; another member may receive a different notification for the same underlying event. This is a proposed architecture supported by distinct surfaces, not proof of Typefully's storage model.

## 10. Proposed data relationships

```text
User ── Membership(role, status) ── Team
                                      │
                                      └─ owns SocialSet
User ── owns private SocialSet
SocialSet ── ConnectedAccount[provider]
SocialSet ── Draft ── Comments / ActivityEvents
User ── NotificationReceipt ── Event
```

Suggested records:

| Record | Key fields / responsibility |
|---|---|
| Team | ID, name, owner reference, plan/entitlement reference |
| Membership | Team, user, role, status, timestamps |
| Invitation | Team, target or token hash, role, expiry, use state |
| TransferIntent | Source/destination owners, affected set, actor, confirmation state |
| PermissionDecision | Action, actor, resource, evaluated role/ownership |
| AuditEvent | Actor, resource, action, time, source |

These field names are proposals. No actual database or endpoint names were recovered.

Use immutable IDs for scope. Do not use a team name as a tenancy key. Keep the creator's ownership role distinct from delegated administrative permission, particularly for billing, transfers, and last-owner rules.

## 11. Proposed lifecycle and error handling

Creation should not leave a team without an owner if membership insertion fails. Invitation acceptance should be atomic and tied to the intended destination. A used, revoked, or expired invitation should return a distinct explanation rather than a generic login loop.

Permission changes should take effect when an action is submitted, even if an old browser tab still shows an enabled button. A removed member should not retain editor, media, audit, notification, or internal-link access solely through cached UI state.

Transfers should recheck source and destination authority immediately before commitment. Scheduled-publication implications should be explicit. Concurrent transfer attempts need conflict handling. These are proposed requirements, not tested claims about Typefully.

An owner leaving or being removed, deleting a team, downgrading plans, and migrating billing require policies that were not visible here. Their behavior must remain unspecified until verified; do not fill them in from generic SaaS conventions.

## 12. Coverage and next verification target

Directly verified: creation entry, name-field structure, empty/whitespace/nonempty button states, cancellation, absence of an eligible transfer destination, personal-set ownership copy, private draft sharing, and public plan inconsistencies.

Documented but not exercised: invitation delivery/acceptance, role capabilities, draft locking, transfer confirmation/cascade, and collaboration access after joining.

Unknown: exact team settings layout, default role, invitation expiry, resend/revoke actions, email uniqueness rules, member removal, role-change side effects, custom roles, team deletion, SSO, billing ownership transfer, quota enforcement, and team activity-feed filtering.

The smallest useful continuation is a dedicated test team with owner, editor, publisher, and viewer accounts, plus one disposable social set. No such environment was created in the user's workspace. See the [build checklist](typefully-social-teams-activity-checklist.md) for explicit test targets.
