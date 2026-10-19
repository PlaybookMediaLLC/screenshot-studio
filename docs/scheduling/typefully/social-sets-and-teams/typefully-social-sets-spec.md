# Typefully Add Social Set — functional reverse engineering

Inspected October 13, 2026 in the authenticated desktop application. This document describes product behavior, not recovered private source code or network contracts.

Evidence: **LIVE** = directly observed UI or interaction; **DOC** = official documentation; **PROPOSED** = a suggested implementation. Provider authorization, credential submission, account creation, removal, and transfers were not executed.

## 1. Domain model and product purpose

A social set is the working context for a person or brand. It should not be confused with a Typefully login, a single provider account, a team, or a draft. The inspected workspace had six personal social sets: three X identities and three LinkedIn identities. Several displayed names were identical across providers, so the name alone cannot identify a set.

**DOC:** A set groups platform accounts and owns drafts, schedule, analytics, and settings. It can belong privately to a user or to a team. New drafts can synchronize content from a primary platform, with platform defaults configurable separately. Team ownership makes the set available to members according to role. [Social Sets and Accounts](https://support.typefully.com/en/articles/8717684-social-sets-and-accounts)

**DOC:** A Typefully user holds subscriptions; a team groups collaborators and shared sets. A social set allows only one connected account per provider. Team owners alone access team billing, while owners and admins can manage team sets. [Transfer concepts](https://support.typefully.com/en/articles/9920894-requesting-a-transfer-users-social-sets-accounts-and-teams)

**LIVE:** Existing X Oppulence had one connected X account. Its Add Account picker disabled Twitter while offering the other providers. This supports the one-account-per-provider rule without proving every duplicate-account scenario.

## 2. Entry points

| Surface | Visible entry | Scope / behavior |
|---|---|---|
| Main sidebar | Add social set | Opens creation wizard |
| Personal heading | Add social set to your personal workspace | Owner context is explicit in accessible label |
| Settings → Social Sets | New social set | Management entry point |
| Existing set row | Add platform to [name] | Adds a provider to an existing set |
| Existing set General settings | Add social account | Opens account picker for that set |
| Write editor | Manage platforms | Draft/platform management entry; connection behavior covered in the earlier Write specification |

The main creation wizard opened as a centered modal over Analyze. The URL remained `/grow?d=1m`. Therefore the inspected flow is layered over the current workspace view, rather than a required navigation to a standalone onboarding route.

## 3. New-set platform picker

**LIVE:** The heading is Create a Social Set. The explanatory sentence asks the user to select the first platform to enable. Six provider buttons are present:

1. Twitter.
2. LinkedIn.
3. Mastodon.
4. Threads.
5. Bluesky.
6. Substack.

There is a Close control. No name field, avatar upload, role selection, billing choice, or draft-import option appeared in this first screen.

The picker uses Twitter while the connection modal uses X branding. Preserve a stable provider identity behind those labels; do not treat them as separate integrations.

**DOC:** The documented creation sequence authenticates the first provider to establish a new set, then permits adding more accounts. Set switching loads the corresponding content and scheduling context. Moving a set is an ownership transfer, not merely adding access. [Managing Multiple Social Sets](https://support.typefully.com/en/articles/8717640-managing-multiple-social-sets)

The final successful creation, default name, avatar derivation, new-set selection, and success notification were not observed because no provider authorization was submitted.

## 4. Provider branch matrix

All six branches were opened and inspected before their connection action.

| Provider | Heading | Local inputs | Commit boundary |
|---|---|---|---|
| X | Connect X Account, with stylized X | None | Connect X account |
| LinkedIn | Connect LinkedIn Account | None | Connect LinkedIn account |
| Threads | Connect Threads Account | None | Connect Threads account |
| Substack | Connect Substack Account | None | Connect Substack account |
| Bluesky | Connect Bluesky Account | Handle, App Password | Disabled Connect button when empty |
| Mastodon | Connect Mastodon Account | Server selector; custom-instance input when selected | Connect Mastodon account |

X, LinkedIn, Threads, and Substack explicitly say the user will be taken to the provider to authorize the connection. This establishes an authorization handoff, not the exact OAuth version, scopes, callback mechanism, or popup behavior.

### X

The modal includes a reminder to select the correct identity when logged into multiple X accounts, with a link to `https://x.com/account/switch`. The Connect action was not pressed. Delegate-account behavior and provider permissions were not tested in this session.

### LinkedIn

The inspected pre-authorization modal contains the handoff explanation, Connect, and Close. It does not yet ask personal profile versus company page. That choice may occur later; it was not visible here and must not be invented as an observed step.

### Threads

The same compact handoff pattern appears with Threads identity. Meta account selection, authorization denial, and disconnected-session behavior remain unverified.

### Substack

In addition to authorization copy, the UI states that Typefully can publish Notes to the Substack profile. Do not turn this into a claim of newsletter or long-form article publishing through this flow.

### Bluesky

The modal links to Bluesky's FAQ and app-password settings. It explicitly requires an app password and says the regular account password will not work. The form has separate Handle and App Password fields. Connect is disabled when both are empty.

No handle or password was entered. Masking behavior, custom-domain handles, handle normalization, validation timing, password-error messages, and credential storage were not established. A reconstruction must not infer that the accessible text-field representation proves a secret is unmasked visually.

### Mastodon

The selector initially used mastodon.social and listed:

| Server | UI description |
|---|---|
| mastodon.social | Official Mastodon Server |
| fosstodon.org | FOSS & Tech Community |
| mas.to | General Purpose Instance |
| mstdn.social | Large General Instance |
| techhub.social | Tech Community |
| Custom | Enter custom instance… |

The modal includes a server preview area and a signup-help link. Its preview initially showed a loading/placeholder sentence, then a server name, description, and user count. The count is dynamic and is not a product invariant.

Selecting Custom revealed an empty text field and disabled Connect. A previously loaded mastodon.social preview was still present in the immediate transition snapshot. This is evidence of transient stale preview content; persistence of that mismatch was not tested.

No custom URL was entered and no server connection was attempted. Accepted URL syntax, normalization, private-server support, server probing, error handling, and authorization callbacks remain unknown.

## 5. Modal navigation and cancellation

**LIVE:** Closing each provider-specific form returned to the parent platform picker. Closing that picker returned to the underlying application. Provider selection alone did not add a new row to the set list.

The UI sometimes completed dismissal shortly after the first accessibility snapshot. The screen was checked after transitions rather than treating an immediate unchanged snapshot as a failed close.

**PROPOSED state machine:**

```text
closed
  → choosing first provider
  → provider-specific local form
  → external authorization / credential verification
  → callback validation
  → set created and selected

local form Close → provider picker
picker Close → original page
authorization failure → recoverable provider error
```

Only the states before authorization and their Close transitions were observed. The latter half is a recommended model for a comparable system, not Typefully's recovered state machine.

## 6. Adding to an existing set

**LIVE:** Existing X Oppulence → Add social account opened Add Account to “Oppulence”. The explanation referred to adding an account to this set, rather than choosing a first platform. LinkedIn, Mastodon, Threads, Bluesky, and Substack were enabled. Twitter was displayed last and disabled.

This distinction affects the target resource. New-set creation needs an owner context. Existing-set connection needs the specific set ID and authority to modify it. A shared UI component can handle both, but must not rely on the currently highlighted account alone when an authorization callback arrives later.

Unverified cases include an external account already connected elsewhere, moving one provider connection between sets, replacing an existing provider, and whether a reconnect changes identity or only renews authorization.

## 7. Management view and connection health

**LIVE:** Settings → Social Sets lists sets under Personal. Rows expose:

- Avatar and name, with a settings entry.
- Provider icon(s).
- Add platform control.
- Social set settings control.
- Optional attention message and Manage platforms action.

One existing X set showed Some accounts need attention. Its General screen had a red warning triangle alongside the connected identity, Reconnect, and Remove controls. Clicking the warning did not expose an explanatory message in the inspected state. The exact cause—expiration, revocation, missing permission, provider error, or another condition—was not established. No repair was attempted.

The General screen also exposed Name, Color, Connected Accounts, Add social account, default-platform settings, Ownership and Sharing, Move to team, and Delete social set under Danger Zone. A developer ID was visible in this account configuration; this is not proof that every user sees internal IDs.

No identity, color, provider default, or connection was changed. Remove and Delete were not opened; recovery and cascade semantics remain unknown.

## 8. Ownership boundary

**LIVE:** General settings said the inspected set was private and could be moved to a team to share it with collaborators. Move to team opened Move Social Set and Drafts. It explained that team members could write and publish according to their role.

The destination screen contained a search field and a message requiring ownership or admin membership in a team. No eligible destination was listed. This was a concrete availability limit for this account, not a claim that the feature is broken.

See [Team specification](typefully-teams-spec.md) for documented role and transfer rules. No move was committed.

## 9. Proposed internal contracts

These are design suggestions only:

```text
SocialSet
  id, ownerType(user|team), ownerId, name, color, avatar

ConnectedAccount
  id, socialSetId, provider, providerAccountId
  handle, displayName, avatar, connectionState, grantedCapabilities

ConnectionAttempt
  id, actorId, mode(createSet|addAccount|reconnect)
  targetOwner / targetSetId, provider, expiresAt, status

PlatformDefaults
  socialSetId, primaryProvider, enabledProviders, order
```

A provider-account identity should use a stable provider ID, not only a mutable handle. The authorized target should be bound to a connection attempt before leaving the app. A callback should not attach an account to whichever set happens to be selected afterward.

Recommended invariants: one provider slot per set; server-side owner/role checks; no accidental empty set after denied authorization; idempotent callback handling; no secret values in URLs, logs, or audit display; clear distinction between reconnecting and replacing identity; preservation of existing drafts after a failed reconnect.

These protections were not tested against Typefully. Neither the visible forms nor help pages establish its credential encryption, network protocol details, databases, or background workers.

## 10. Limits of this inspection

Verified: six provider entry forms, custom-server empty state, creation versus add-account distinction, disabled existing provider, nested cancellation, ownership picker restriction, account-health warning, and management controls.

Not verified: provider consent scopes, authorization success/cancel/error pages, creation success state, LinkedIn page selection, account deduplication, credential validation, quotas at commit time, multi-team connection behavior, reconnect durability, removal recovery, or backend implementation.

No credentials were entered or collected. The six existing personal sets remained the available workspace entries. For plan limits and the observed pricing contradictions, see the [Team specification](typefully-teams-spec.md). For implementation coverage, see the [build checklist](typefully-social-teams-activity-checklist.md).
