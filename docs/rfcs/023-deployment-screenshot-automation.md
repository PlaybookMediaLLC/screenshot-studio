# RFC 023: Deployment-Driven Screenshot Automation

**Status:** Proposed
**Date:** 2026-08-17
**Depends on:** RFC 022
**Owners:** Engineering

## Decision

Capture feature screenshots automatically after successful deployments. This
removes one of the founder's biggest marketing annoyances: manually creating
the actual assets.

## Design

Event chain:

```text
PR merged
     ↓
deployment successful
     ↓
feature identified
     ↓
browser opens deployed app
     ↓
navigate to feature
     ↓
capture screenshot
     ↓
Screenshot Studio beautifies it
     ↓
campaign generated
```

Details:

- Deployment webhooks (Vercel, Fly.io, or generic) join the GitHub events
  from RFC 022.
- Navigation targets come from the `ProductSurface` map (RFC 013). The
  feature identified in the PR selects the surface.
- Capture runs through the existing capture API and its SSRF guards.
  Authenticated app areas require a workspace-provided demo account.
- New captures update the surface's screenshot set and refresh the suggested
  campaign's creatives.
- Before/after pairs come from the surface's previous capture plus the new
  one.

## Exit criterion

A merged feature PR plus a successful deployment produces fresh, beautified
screenshots of the changed screen, attached to a suggested campaign, with no
manual capture.

## Out of scope

- Video demos. RFC 024 covers demo generation.
- Complex in-app interaction scripting beyond navigation to a surface URL.
