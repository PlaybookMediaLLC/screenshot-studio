# Typefully Social Sets, Teams, and Activity — build checklist

Prepared October 13, 2026. These are acceptance criteria for a comparable implementation, not tests already passed against Typefully.

Read the linked specifications for evidence and limitations: [Social Sets](typefully-social-sets-spec.md), [Teams](typefully-teams-spec.md), [Inbox/Activity](typefully-inbox-activity-spec.md).

**Observed** identifies directly inspected controls or states. **Documented** points to vendor rules in the specifications. **Proposed** identifies engineering requirements that still need verification. An Observed control does not imply its commit action was tested.

## 1. Social-set connection criteria

| ID | Acceptance criterion | Basis |
|---|---|---|
| S01 | Distinguish Typefully user, team, social set, and connected provider account. | Observed + documented |
| S02 | Creation receives an explicit private/team owner context. | Observed private entry; team path untested |
| S03 | First-platform picker contains the six inspected providers. | Observed |
| S04 | Twitter and X labels resolve to one provider identity. | Observed |
| S05 | X branch includes correct-account guidance before authorization. | Observed |
| S06 | LinkedIn and Threads branches clearly signal external authorization. | Observed |
| S07 | Substack branch describes Notes capability accurately. | Observed |
| S08 | Bluesky requires Handle and App Password, with an empty disabled state. | Observed |
| S09 | Mastodon offers known servers, custom entry, and server preview. | Observed |
| S10 | Custom Mastodon entry cannot connect while empty. | Observed |
| S11 | Server preview clears or explicitly stays loading when its selected target changes. | Proposed; transient mismatch observed |
| S12 | Provider Close returns to picker; picker Close restores the original page. | Observed |
| S13 | Existing-set picker names the target and disables its connected provider. | Observed |
| S14 | Already-linked external identities return an explicit conflict outcome. | Proposed |
| S15 | Authorization attempts remain bound to the original owner/set across tab switches. | Proposed |
| S16 | Repeated or expired callbacks cannot create duplicate or unintended sets. | Proposed |
| S17 | Denied authorization or failed credential verification leaves existing content intact. | Proposed |
| S18 | Connection attention state offers clear diagnosis and an appropriate reconnect path. | Observed warning; diagnosis unverified |
| S19 | Quotas are checked at commitment using authoritative entitlements. | Proposed |
| S20 | Successful add/reconnect is verified by identity, capability, and durable set membership. | Proposed; no success path executed |

## 2. Team criteria

| ID | Acceptance criterion | Basis |
|---|---|---|
| T01 | Team creation opens without forcing a change of the active main page. | Observed |
| T02 | Name field, explanatory copy, help link, Create, and Close are present. | Observed |
| T03 | Empty and whitespace-only names cannot create a blank-looking team. | Empty observed; whitespace frontend weakness found |
| T04 | Name length, Unicode, duplicate-name, and normalization policies are explicit. | Proposed |
| T05 | Cancelling the form does not create a team or retain unintended input. | Observed unsaved cancellation |
| T06 | Team creation and owner membership are atomic. | Proposed |
| T07 | Empty-team onboarding separates connecting accounts, moving sets, and inviting people. | Proposed |
| T08 | Current entitlements and legacy plans resolve consistently across UI and server. | Proposed; documentation mismatch found |
| T09 | Agency's team allowance has one authoritative value. | Proposed; live pricing contradiction found |
| T10 | Invitation/role behavior follows the documented contract in Teams §5. | Documented; not executed |
| T11 | Accepting, rejecting, reusing, revoking, and expiring invitations are tested separately. | Proposed |
| T12 | Role checks happen server-side at action time, including stale browser sessions. | Proposed |
| T13 | No eligible transfer destination shows an explanatory state. | Observed |
| T14 | Transfer effects follow the documented contract and expose consequences before commit. | Documented; not executed |
| T15 | Concurrent or repeated transfer commands cannot split ownership. | Proposed |
| T16 | Member removal revokes draft, media, audit, internal-link, and notification access. | Proposed |
| T17 | Last-owner, owner departure, deletion, and downgrade policies are specified. | Proposed; existing rules unknown |
| T18 | Draft edit contention is tested in separate user sessions. | Documented locking; not executed |
| T19 | Internal feedback links do not grant membership or publication rights. | Observed private-link wording; Proposed access test |
| T20 | Team billing authority is distinct from delegated content administration. | Documented; not executed |

## 3. Inbox, delivery, and audit criteria

| ID | Acceptance criterion | Basis |
|---|---|---|
| N01 | Notification trigger and settings icon have descriptive accessible names. | Proposed; unnamed controls observed |
| N02 | Inbox, Activity, and Archive have one clear selected state. | Observed |
| N03 | Tab selection persists as intended without leaking another tab's rows. | Same-session retention observed; Proposed race test |
| N04 | Loading, empty, permission-denied, and request-failure states differ. | Empty/loading observed; Proposed error coverage |
| N05 | Populated row structure, unread semantics, and target navigation are verified with real fixtures. | Unverified |
| N06 | Archive, restore, and bulk-operation rules are established before implementation claims. | Archive tab observed; mutations unverified |
| N07 | Settings icon opens Notifications while preserving the active main page. | Observed |
| N08 | Email master, comment category, and account-level preferences are independently represented. | Observed |
| N09 | Group toggles have defined partial-selection and child-update behavior. | Group controls observed; behavior untested |
| N10 | Each repeated preference is labeled with account, event, and channel context. | Proposed accessibility requirement |
| N11 | Personal Slack DMs and team Slack channel publishing use distinct configuration scopes. | Observed DM entry + documented team scope |
| N12 | Delivery exceptions and self-action rules follow Inbox/Activity §7 with explicit precedence. | Documented; not measured |
| N13 | Connection expiration, master-off, category-off, and failed delivery are tested separately. | Proposed |
| N14 | Notification delivery retries are idempotent and do not duplicate audit events. | Proposed |
| N15 | Resource access is rechecked when a stale notification is opened. | Proposed |
| N16 | Draft history lives in Draft Properties, separate from the global feed and comments. | Observed |
| N17 | Audit groups expose actor, relative time, and expandable change categories. | Observed |
| N18 | Automated source attribution follows the documented audit contract without exposing secrets. | Documented source labels; Proposed privacy test |
| N19 | Retention, grouping, ordering, and history-versus-version-recovery behavior are explicitly defined. | Unverified; no restore UI observed |
| N20 | Integrations use currently supported public contracts rather than guessed notification endpoints. | Documented migration limitation |

## 4. Concrete findings register

| Finding | Evidence strength | Interpretation |
|---|---|---|
| Three spaces enabled Create team | Direct unsaved input experiment | Client readiness check accepts whitespace; server validity unknown |
| Mastodon custom selection briefly retained old preview | Immediate transition snapshot | Potential stale-preview state; persistent defect not established |
| X account had an attention warning | Overview message and red account icon | Connection-health issue exists; its cause was not diagnosed |
| Global notification controls lacked accessible names | Accessibility tree, verified visually | Reconstruction should improve semantic labels |
| Inbox, Activity, Archive were empty | All three settled states | Populated-row behavior could not be reverse engineered live |
| Private set had no eligible team destination | Explicit owner/admin requirement | Team transfer could not proceed to destination confirmation |
| Collaboration guide and pricing plan names differ | Current rendered pricing versus official guide | Do not treat the guide's plan names as current entitlements |
| Agency card and table disagree | Card says unlimited teams; table shows 50 | Enforced team limit remains unresolved |
| Draft Activity shows categories, not a full text diff | Expanded existing event | Do not claim version restore or field-level before/after history |

These are different kinds of finding. An empty inbox or missing eligible team is an account-state limit, not a product defect.

## 5. Suggested test fixtures

Use a disposable environment with two private social sets, one team, two identically named provider identities, and four role-specific users. Add a connected provider, a revoked connection, an already-linked external identity, and a custom Mastodon test server. Keep real account credentials out of the research artifact.

For teams, include a new invitation, accepted invitation, expired token, reused link, downgraded member, removed member, and last-owner case. Add a set with drafts and scheduled content so transfer consequences can be tested safely.

For notifications, create a draft comment, reply, mention, manual publication, scheduled publication, automatic engagement action, and publication failure. Include recipients with different access and delivery preferences. Populate all notification tabs before checking archive/read behavior.

For audit history, exercise one-field edits, grouped edits, undo, tags, provider enablement, scheduled-date changes, automation-source changes, and actor removal. Determine whether events represent saves, semantic changes, or time-window batches. These fixtures were not generated in the user's account.

## 6. Proposed implementation boundaries

| Service or UI boundary | Responsibility |
|---|---|
| Owner context | Private user versus team target |
| Provider connection wizard | Provider-specific inputs and callback recovery |
| Connected-account registry | Identity, capabilities, slot uniqueness, health |
| Team membership | Roles, invitations, acceptance, removal |
| Entitlement evaluator | Social-set/team limits and legacy-plan resolution |
| Ownership transfer | Explicit consequences, authority, atomic commitment |
| Domain event history | Immutable resource changes and actor/source attribution |
| Notification projection | Recipient-specific Inbox/Activity/Archive state |
| Delivery preferences | User/channel/event/account policy |
| Delivery jobs | Email/Slack retries, deduplication, failure reporting |
| Draft Activity UI | Read-only event timeline and category expansion |

These are proposed boundaries, not observed Typefully services. Their separation follows the visible product responsibilities and prevents a common design error: using one mutable notification table as both a durable audit record and a delivery queue.

## 7. Handoff and scope

The research files distinguish live evidence, written documentation, proposals, and gaps. No provider authorization was initiated. The team-name experiment was cleared without submission. No team, invitation, connection, move, comment, notification delivery, public share, or publication was committed. Existing draft content was not edited during this request.

The user's tab was returned to X Oppulence Analyze with the one-month range. The global notification panel was closed with its initial Activity tab restored. Research tabs were closed. The next meaningful verification requires a populated disposable team and notification environment, not further inspection of the same empty states.
