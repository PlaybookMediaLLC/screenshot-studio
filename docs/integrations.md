# Sharing and integrations

Published designs live at share links. Slack, Notion, and Figma receive them
through each provider's own API and OAuth. This page covers what an operator
sets up and what each integration does.

## Share links

The editor's **Share** button exports the design through the same pipeline as
**Save**, uploads it to the workspace's assets, and publishes it:

- `/s/<token>` is the share page. It carries Open Graph and X card tags, so the
  link previews as the image in Slack, X, LinkedIn, and the Link Preview checker.
  It is never indexed.
- `/s/<token>/embed` is the chromeless page for iframes.
- `/api/share/<token>/media` serves the bytes, with range requests for video.

The token is 24 random bytes, base64url-encoded. Access is **Anyone with the
link** or **Workspace members**; members-only links answer only to signed-in
members whose active workspace owns the link. Links can expire after 1, 7, or
30 days, and owners, admins, and creators can revoke them. Revoked and expired
links return 404 everywhere. **Settings → Shared links** lists every link.

## Integrations

Owners and admins connect accounts in **Settings → Integrations**. Anyone who
can edit designs delivers through a connection from the Share dialog.

| Provider | What it does                                                                                                                                                                                                                                    | Scopes                                                                       |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Slack    | Uploads the file to a channel, with the message and the share link. The app joins public channels itself; private channels need `/invite`.                                                                                                      | `chat:write`, `files:write`, `channels:read`, `channels:join`, `groups:read` |
| Notion   | Uploads the file with the File Upload API, then appends it, captioned, and a bookmark to the share page to a page shared with the integration.                                                                                                  | Public integration, read and insert content                                  |
| Figma    | Posts a comment with the share link, pinned to the frame when the link names one. Figma's REST API cannot place images on a canvas, so the Share dialog also has **Copy image for Figma**: the PNG goes on the clipboard and pastes into Figma. | `current_user:read`, `file_comments:write`                                   |

Slack OAuth, encrypted installations, refresh, channel discovery, design uploads,
and publishing are owned by Go. The existing connection IDs and web routes remain
compatibility adapters. See [workspace activity operations](workspace-notifications.md)
for backend configuration, migration, and recovery.

Notion and Figma keep their existing web facade lifecycle and
`INTEGRATION_ENCRYPTION_KEY`. Their expiring tokens refresh before expiry. A
revoked token asks the user to connect again.

### Setup

Set these on the web service:

```bash
# 32 random bytes, base64. Rotating it means reconnecting every account.
INTEGRATION_ENCRYPTION_KEY=$(openssl rand -base64 32)
NOTION_CLIENT_ID=...   NOTION_CLIENT_SECRET=...
FIGMA_CLIENT_ID=...    FIGMA_CLIENT_SECRET=...
```

Register this redirect URL with each provider app:
`<NEXT_PUBLIC_APP_URL>/api/integrations/<slack|notion|figma>/callback`.

- **Slack**: configure credentials on the Go API and worker, never the web service.
  Follow the [Slack setup and distribution guide](workspace-notifications.md#slack).
- **Notion**: create a _public_ integration at notion.so/profile/integrations with the
  _Insert content_ and _Read content_ capabilities, and set the redirect URI.
- **Figma**: create an app at figma.com/developers/apps with the scopes above and
  the callback URL. Figma reviews apps before they work outside your own team.

A provider without its client ID and secret, or without
`INTEGRATION_ENCRYPTION_KEY`, shows as not set up and names the missing settings.
Nothing about it is simulated.
