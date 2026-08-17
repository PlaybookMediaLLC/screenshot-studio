# RFC 021: The Three Core Workflows

**Status:** Proposed
**Date:** 2026-08-17
**Depends on:** RFC 015 through RFC 020
**Owners:** Product and Engineering

## Decision

Do not expand horizontally. Get three workflows excellent. These cover most
of what an early-stage founder needs.

## The workflows

### Workflow 1 — Launch something

Input:

```text
"We launched Acme."
```

Output: a launch campaign built from the product profile and surfaces.

### Workflow 2 — Ship a feature

Input:

```text
"We just shipped team permissions."
```

Output: a feature campaign (RFC 015) with the matching product surface.

### Workflow 3 — Market existing product

Input:

```text
"Give me content for this week."
```

Output: a campaign generated from existing product intelligence, without new
input.

## Onboarding as the product

The new-user experience combines RFC 012 with Workflow 1:

1. The user creates a workspace and enters their URL.
2. The system derives the product, audience, problems, brand, and content
   pillars.
3. The system generates the first seven posts on a calendar, built from the
   user's actual application.

The first screen shows "We've created your first 7 posts", not "How can I
help?". Chat is secondary.

## Exit criterion

A new user goes from URL to seven approvable posts with real product
screenshots in one session. All three workflows produce campaigns founders
approve with minor edits.

## Out of scope

- GitHub triggers (RFC 022), demo videos (RFC 024), and weekly autonomy
  (RFC 029).
