# RFC 014: Structured Marketing Objects

**Status:** Proposed
**Date:** 2026-08-17
**Depends on:** RFC 011 through RFC 013
**Owners:** Engineering

## Decision

Model campaigns as first-class database objects before any agent exists. Chat
manipulates structured objects. We do not store campaigns as
`conversation.messages[]`. That is a trap.

## Data model

The system understands these concepts natively:

```text
Campaign
CampaignBrief
ContentAngle
Creative
Post
Publication
Performance
```

Core shapes:

```text
Campaign
├── objective
├── audience
├── feature
├── messaging
├── contentAngles[]
├── creatives[]
├── posts[]
├── status
└── performance

Post
├── channel
├── copy
├── creativeId
├── CTA
├── status
├── scheduledAt
└── publicationId
```

All objects are workspace-scoped and covered by the existing RBAC and audit
infrastructure (RFC 003).

## Why this matters

The LLM produces structured intent. The database owns the campaign. A founder
can then:

- regenerate one image,
- change one hook,
- move one post,
- approve three posts and reject one,
- reuse a campaign,

without replaying an agent conversation.

## Exit criterion

A campaign with angles, creatives, and posts persists and round-trips through
the tenant API with no LLM involvement.

## Out of scope

- Generation logic. RFC 015 adds the first recipe.
- Publication mechanics. RFC 020 connects Postiz.
