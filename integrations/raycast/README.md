# Shots for Raycast

Create editable single posts or threads, choose a workspace social set and platforms, search drafts, duplicate or delete unscheduled drafts, and inspect recent or upcoming deliveries. Four AI tools create, list, read, and **plan** drafts. Planning does not schedule publishing. Human approval and publishing confirmation remain in Shots, as required by RFC 037/038.

This source extension uses the existing Shots REST API. It has not been published in the Raycast directory or exercised in the macOS Raycast host. A successful CLI build establishes packaging and type compatibility only.

## Local installation

On a Mac with Raycast installed:

1. Run `npm ci`, then `npm run build` in this directory.
2. Import this directory with Raycast's **Import Extension** command.
3. Set your Shots HTTPS origin and a workspace API key with `artifact:read` and `draft:write`. A Pro or higher workspace must have content drafts enabled. Store the key only in the password preference.
4. Open **Create Draft**, select the team social set and platforms, and write. Separate posts with a line containing `---` (up to 25). Creation opens the resulting draft in Shots for review.
5. Use **Browse Drafts** to find it again, or **View Publishing Queue** to inspect delivery outcomes. Publication times appear in the computer's time zone.

Private social sets require the owner's Shots session and do not appear to API keys. An unavailable scope, revoked key, missing entitlement, or provider connection is reported by the existing API; the extension cannot override these checks.

An uncertain creation retains its import receipt in local storage, scoped to the deployment and API key. Retry the same text and destinations to reuse it. AI callers must supply and retain a stable `requestId`. Deletion asks for confirmation and the server refuses drafts with active delivery commands.

## Verification and release

`npm test` validates payloads against the actual application contracts, retry identity, response envelopes, pinned results, secret origin restrictions, and denied/rate-limited requests. `npm run build` compiles the three commands and four AI tools.

Before store submission, a maintainer must confirm the Raycast publisher handle in `package.json`, run the commands in the macOS host against a controlled Shots workspace, and obtain directory approval. No directory approval or live provider success is implied by this package.
