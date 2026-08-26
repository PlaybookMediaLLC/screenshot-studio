# RFC 021: The Three Core Workflows

**Status:** Proposed
**Date:** 2026-08-17
**Revised:** 2026-08-26
**Depends on:** RFC 015 through RFC 020
**Owners:** Product and Engineering

## Decision

Do not expand horizontally. Get three workflows excellent. These cover most
of what an early-stage founder needs.

This is the chargeable milestone. When a founder can paste a URL, receive seven
good posts with real product screenshots, approve them, and schedule them, the
product is sellable. Everything after that expands the same object model.

## The workflows

Each workflow is a recipe on the RFC 015 step framework. They share
context resolution, surface matching, capture, generation, and assembly, and
differ in inputs, angle strategy, and post count.

### Workflow 1 — Launch something

Input:

```text
"We launched Acme."
```

Output: a launch campaign built from the product profile and surfaces.

| Property        | Value                                                      |
| --------------- | ---------------------------------------------------------- |
| Entry           | Onboarding completion, the empty state, or chat             |
| Required        | `ProductProfile` with a description and at least one surface |
| Angles          | 3 to 5, spanning problem, benefit, and differentiator       |
| Posts           | 5 to 7 across the workspace's default channels              |
| Creatives       | Hero screenshot per angle, plus one annotated               |
| Exit            | Campaign in `DRAFT`, every post carrying copy               |
| Missing profile | Route to onboarding; do not generate from nothing           |

### Workflow 2 — Ship a feature

Input:

```text
"We just shipped team permissions."
```

Output: a feature campaign (RFC 015) with the matching product surface.

| Property        | Value                                                     |
| --------------- | --------------------------------------------------------- |
| Entry           | Chat, the campaign list, or a GitHub suggestion (RFC 022)  |
| Required        | `ProductProfile`; a matching surface is strongly preferred |
| Angles          | 3, focused on the single feature                           |
| Posts           | 3 to 5                                                     |
| Creatives       | Feature surface screenshot, annotated variant              |
| Exit            | Campaign in `DRAFT`                                        |
| No surface match| Proceed with a stated fallback and a visible warning        |

### Workflow 3 — Market existing product

Input:

```text
"Give me content for this week."
```

Output: a campaign generated from existing product intelligence, without new
input.

| Property        | Value                                                        |
| --------------- | ------------------------------------------------------------ |
| Entry           | Chat, the calendar, or the recurring cycle (RFC 029)          |
| Required        | `ProductProfile` and published or drafted history            |
| Angles          | 5 to 7, varied by pillar (RFC 025) once pillars exist         |
| Posts           | 5 to 7, one per planned day                                   |
| Creatives       | Mixed: screenshots, quote cards, comparisons                  |
| Novelty         | Must not repeat a hook used in the last 30 days               |
| Exit            | Campaign in `DRAFT` with proposed dates                       |

Novelty enforcement is deterministic: recent hooks are passed to generation as
exclusions and near-duplicates are rejected after generation by normalized
similarity. Workflow 3 runs weekly forever, and a system that produces the same
five posts every week is worse than no system.

## Onboarding as the product

The new-user experience combines RFC 012 with Workflow 1:

1. The user creates a workspace and enters their URL.
2. The system derives the product, audience, problems, brand, and content
   pillars.
3. The system generates the first seven posts on a calendar, built from the
   user's actual application.

The first screen shows "We've created your first 7 posts", not "How can I
help?". Chat is secondary.

### The onboarding sequence

```text
Sign up
   ↓
Enter URL                          RFC 032 fast path, < 10s
   ↓
Review the derived profile          editable, pre-filled, skippable
   ↓
Background enrichment               RFC 032, minutes, non-blocking
   ↓
Workflow 1 runs                     RFC 015 recipe
   ↓
"We've created your first 7 posts"  RFC 018 workspace
   ↓
Approve                             RFC 019 batch approval
   ↓
Connect a channel                   RFC 020
   ↓
Schedule
```

Timing targets, measured from URL submission:

| Milestone                  | Target  |
| -------------------------- | ------- |
| Reviewable profile         | 10s     |
| First post visible         | 60s     |
| All seven posts with copy  | 3 min   |
| All creatives rendered     | 5 min   |

Posts stream into the workspace as they are generated. A founder should be
reading real post copy well before generation completes. Five minutes of
spinner loses the user; five minutes of visibly filling calendar does not.

### Channel connection placement

Channel connection comes after approval, not before generation. A founder
should see the value before being asked to connect an account. This ordering
also means the entire onboarding works while RFC 020's OAuth gap is open: the
founder gets seven approved posts and hits the connection step, which is a far
better failure point than the first screen.

## Degradation

Onboarding must produce something useful in every partial-failure case.

| Failure                       | Outcome                                                    |
| ----------------------------- | ---------------------------------------------------------- |
| Crawl fails                   | Manual profile form, then Workflow 1 proceeds              |
| No surfaces captured          | Posts generate with brand-only creatives                   |
| Some captures fail            | Those posts get brand-only creatives, flagged              |
| Copy generation partly fails  | Fewer posts, stated plainly, with a generate-more action   |
| Renders fail                  | Posts appear without creatives and can be retried inline   |
| Everything fails              | Manual campaign creation with templates                    |

The floor is that a founder always reaches a workspace with something to act
on. "We could not analyze your site, here is a form" is an acceptable
onboarding. A spinner that never resolves is not.

## Cross-workflow contract

All three workflows:

- run on the RFC 015 step framework with the same retry and resume semantics;
- require `release:create` and consume generation quota;
- produce campaigns in `DRAFT` only;
- record provenance naming the workflow, its version, and its inputs;
- are idempotent by key, so a retried request produces one campaign;
- are cancellable, keeping partial artifacts;
- write audit entries for every step.

A workflow never publishes, never approves, and never modifies brand or
product context. Workflow 2 triggered by a GitHub suggestion still produces a
draft that a human approves.

## Acceptance criteria

1. A new user goes from URL to seven approvable posts with real product
   screenshots in one session.
2. All three workflows produce campaigns founders approve with minor edits.
3. The reviewable profile appears within 10 seconds of URL submission.
4. The first generated post is visible within 60 seconds.
5. Every post has copy within 3 minutes and creatives within 5 minutes.
6. Posts appear incrementally rather than all at once at the end.
7. Onboarding completes with a usable workspace when the crawl fails.
8. Onboarding completes with a usable workspace when every render fails.
9. Workflow 1 with no product profile routes to onboarding instead of
   generating.
10. Workflow 2 with no matching surface generates with a visible warning.
11. Workflow 3 produces no hook used in the previous 30 days.
12. Every workflow produces `DRAFT` only.
13. Batch approval approves all seven posts in one action and one audit entry.
14. A workspace with no connected channel can still approve, and scheduling
    offers connection.
15. A cancelled workflow keeps what it created.
16. A retried workflow with the same idempotency key produces one campaign.

## Measurement

The milestone is met when these hold on real workspaces:

- Share of new workspaces reaching seven approved posts in the first session.
- Median time from sign-up to first approval.
- Edit distance on generated copy before approval.
- Share of posts approved without edits.
- Share of workspaces returning to run Workflow 2 or 3 within 14 days.

Return rate is the one that matters. A founder who runs onboarding once and
never comes back received a demo, not a product.

## Rollout

1. Ship Workflow 2 first. It is RFC 015's recipe and has the narrowest inputs.
2. Ship Workflow 1 by extending Workflow 2 to multi-angle and multi-surface.
3. Ship the onboarding sequence wiring RFC 032 to Workflow 1.
4. Instrument the funnel; iterate on prompts against edit distance.
5. Ship Workflow 3, initially without pillars.
6. Add pillar balance when RFC 025 lands.

## Out of scope

- GitHub triggers (RFC 022), demo videos (RFC 024), and weekly autonomy
  (RFC 029).
- Billing and usage quotas, which still need their own RFC before this
  milestone is chargeable.
- Authenticated page capture, which limits how many real product screens
  Workflow 1 can reach.
