# Typefully backlog triage

> Historical baseline from October 19, 2026. This table is preserved for traceability. The reopened assignment revalidates each row in [coverage.md](coverage.md); do not use these old Exists/Missing labels as current completion claims.

This file applies Step 1 (status) and Step 2 (epic) of the [method](README.md) to all 109 entries in the [backlog](../changelog-features.md).

- **Checked against:** `main` at `f4c9b830`, on 2026-10-19.
- **Sources:** the draft code (`components/drafts`, `lib/content-drafts`, `lib/api/contracts/content-drafts.ts`, `services/internal/product/content_draft*.go`, `services/internal/postoptions`), the social adapters, RFC 013, RFC 026, and RFC 042.
- **Limit:** the triage used code search. A feature with an unusual name can hide from a search. Before you write a work item, confirm the status in the code.

**October 24 update:** [implementation-evidence.md](implementation-evidence.md) supersedes the historical statuses below for the 42 entries in Sections 2, 4 and 5. It records actual implementation, executed browser/backend tests and remaining gates. The remaining 67 entries have not been re-triaged by this assignment.

## Epics

| Epic | Name | Partial or Missing | RFC 042 priority |
|---|---|---|---|
| POLL | Polls on more channels | TF-109 | P1 (channel options) |
| XOPT | X post options | TF-049, TF-061, TF-063, TF-073, TF-076, TF-089, TF-097, TF-102, TF-107 | P1 (channel options) |
| LIOPT | LinkedIn post options | TF-071, TF-077, TF-083, TF-094, TF-098 | P1 (channel options) |
| CHAN | Channels and sign-in | TF-067, TF-082, TF-103 | Unranked. RFC 042 P1 picks other channels first. |
| ANALYTICS | Analytics dashboard | TF-003, TF-044, TF-065 | P3 |
| COLLAB | Notifications, activity, and collaboration | TF-033, TF-090, TF-095, TF-101 | P4 |
| SCHED | Scheduling, queue, and calendar | TF-031, TF-034, TF-053, TF-054, TF-069, TF-072, TF-081, TF-084, TF-104 | P5 (month calendar). TF-072 goes with the P2 "Spread" mode. Others Unranked. |
| QUOTE | Quote and reply to any post | TF-001, TF-018, TF-025, TF-039, TF-108 | Unranked |
| FOLLOW | Follow-up automation | TF-027, TF-064 | Unranked |
| MEDIA | Media | TF-007, TF-019, TF-023, TF-029, TF-038, TF-040, TF-087, TF-092 | Unranked |
| EDITOR | Editor and writing | TF-002, TF-012, TF-016, TF-020, TF-075 | Unranked |
| PREVIEW | Previews and share links | TF-009, TF-057, TF-060, TF-074, TF-078, TF-085, TF-100 | Unranked |
| ORG | Organization and search | TF-032, TF-045, TF-080 | Unranked. Tags and pins are Later. |
| AI | AI writing | TF-026, TF-030, TF-046, TF-070, TF-093 | Unranked |
| AGENT | API, agents, and integrations | TF-013, TF-024, TF-088, TF-091, TF-096, TF-099, TF-106 | Later for draft scheduling by API key (RFC 042). RFC 026 is Proposed. |

Items with the status Verify need a test before they join an epic: TF-005, TF-006, TF-050, TF-058, TF-066, TF-068, TF-105.

## All entries

| ID | Feature | Status | Evidence | Epic |
|---|---|---|---|---|
| TF-001 | Images, quote links, @mention suggestions | Partial | Images, `@handle` suggestions (`lib/content-drafts/vocabulary.ts`), the time zone, and links to live posts exist (RFC 013). A link to a post does not show as a quote. | QUOTE |
| TF-002 | Advanced queue, emoji picker, zen mode, mobile editor | Partial | The weekly slot queue exists (RFC 013, Queue). There is no zen mode. Emoji and the mobile layout: see TF-050. | EDITOR |
| TF-003 | Analytics tab and accent color | Missing | No analytics page in `app/[locale]`. Drafts read one post's metrics on demand (`components/drafts/DraftPosts.tsx`). No app accent color. | ANALYTICS |
| TF-004 | Public analytics link | Later | RFC 042 P3, "Not in this step": public share pages for analytics. | ANALYTICS |
| TF-005 | Scheduling and editor fixes | Verify | Temporal publishing, the workspace time zone, and ⌘↵ for a new post exist (RFC 013). Each listed defect needs a regression test. | EDITOR |
| TF-006 | Faster editor and analytics | Verify | No performance budget for long threads. Measure a 25-post thread. | EDITOR |
| TF-007 | Alt text for images | Missing | Draft images have no alt text field (`components/drafts/DraftComposer.tsx` renders `alt=""`). | MEDIA |
| TF-008 | Best time to post | Exists | `app/api/v1/content-draft-queue/best-times`; RFC 013, Best times. | SCHED |
| TF-009 | Share drafts and unroll published threads | Partial | The share link with guest comments exists (`app/[locale]/d/[token]`, `components/drafts/SharedDraftView.tsx`). No unrolled view after publish. | PREVIEW |
| TF-010 | Multiple X accounts | Exists | A draft targets many `channelConnectionIds` (RFC 013, Data model). | CHAN |
| TF-011 | Auto-repost and auto-plug | Exists | X follow-ups repost and reply at a like count (`components/drafts/XOptions.tsx`, `services/internal/postoptions`). | FOLLOW |
| TF-012 | New editor, high-fidelity preview, focus mode, video | Partial | The Plate editor, per-channel previews, and one video per post exist. No focus mode. No live preview beside the editor. | EDITOR |
| TF-013 | Create drafts from a URL | Missing | No `?new=` handler in `app/[locale]/drafts`. | AGENT |
| TF-014 | Minimal Twitter integration | Skip | A third-party browser extension made for Typefully. | — |
| TF-015 | Public profiles | Skip | A public blog is a separate product. Needs a product decision. | — |
| TF-016 | Automatic thread making from pasted text | Partial | The AI "thread" action splits text (`lib/content-drafts/assist.ts`). No "Make thread" notice on paste. | EDITOR |
| TF-017 | Pinned drafts | Later | RFC 042, Later: "Draft tags and pinning". | ORG |
| TF-018 | Quote the first post at the end of a thread | Missing | The X follow-up quote is a separate post after some hours (`lib/api/contracts/content-drafts.ts:239`). It is not a thread finisher. | QUOTE |
| TF-019 | GIF search with GIPHY | Partial | GIF upload works (`components/drafts/DraftEditor.tsx:512`). No GIF search. | MEDIA |
| TF-020 | Automatic thread numbering | Missing | No numbering in `components/drafts`. | EDITOR |
| TF-021 | Faster scheduling and a rebuilt queue | Exists | "Add to queue" takes the next free slot. The Queue tab lists due posts (RFC 013). | SCHED |
| TF-022 | Teams | Exists | Workspaces with roles, SSO, and SCIM (RFC 042, "What Shots supports today"). | COLLAB |
| TF-023 | Image frames | Partial | Frames are the core of the Shots editor. The draft composer cannot frame an image. | MEDIA |
| TF-024 | Zapier integration | Missing | No Zapier app. The landing FAQ asks about Zapier (`components/platform-landing/pages/IntegrationsPage.tsx:274`). Check that its answer is true. | AGENT |
| TF-025 | Reply, quote, and continue threads | Partial | "Post the rest" resumes a thread that stopped (RFC 013). No reply to or quote of an outside post. | QUOTE |
| TF-026 | Writing prompts library | Missing | No prompt library in the composer. | AI |
| TF-027 | Default follow-up settings | Missing | `content_draft_settings` holds slots, the time zone, and approval only (`services/internal/product/content_draft_platform.go:64`). | FOLLOW |
| TF-028 | Comments on drafts | Exists | Editor discussions and guest comments (`lib/content-drafts/discussions.ts`, `app/api/drafts/shared/[token]/comments`). | COLLAB |
| TF-029 | Remove link previews | Missing | The composer shows a link card when a post has no media. No control removes it. | MEDIA |
| TF-030 | AI writing assistant (Vesper) | Partial | Rewrite, thread, and shorten exist (`lib/content-drafts/assist.ts:17`). No "continue writing", no feedback. | AI |
| TF-031 | Drag and drop in the queue | Partial | A calendar drag moves a post to another day at the same time (RFC 013). No swap. No drop into a free slot. | SCHED |
| TF-032 | Delete multiple drafts | Missing | No multi-select in `components/drafts/DraftsRail.tsx`. | ORG |
| TF-033 | Notifications | Partial | Campaign reviews send mail (`services/internal/product/review_mail.go`). Drafts send nothing (RFC 042 P4). | COLLAB |
| TF-034 | Repurpose published posts | Missing | No action copies a posted item into a new draft. | SCHED |
| TF-035 | Cross-post to LinkedIn | Exists | LinkedIn is a draft channel (`draftChannelLimits` in `services/internal/product/content_draft_schedule.go`). | CHAN |
| TF-036 | Polls on X | Exists | `services/internal/product/content_draft_schedule.go:237`. | POLL |
| TF-037 | Mac app | Skip | A desktop app is a distribution decision, not a draft feature. Needs a product decision. | — |
| TF-038 | Tag users in photos | Missing | No photo tags in the draft path. | MEDIA |
| TF-039 | Thread finisher templates | Missing | No finisher templates. | QUOTE |
| TF-040 | Images from links | Partial | The link card shows the page image in the preview (`lib/content-drafts/link-card.ts`). The image is not attached to the post. | MEDIA |
| TF-041 | Standalone LinkedIn posts | Exists | The user picks the channels for each draft. | CHAN |
| TF-042 | Mac app shortcuts | Skip | Depends on TF-037. | — |
| TF-043 | Auto-DMs | Later | RFC 042, Later: it needs X permissions that other follow-ups do not need. | FOLLOW |
| TF-044 | Analytics CSV export | Missing | RFC 042 P3, step 4: export the post table as CSV. | ANALYTICS |
| TF-045 | Tags, internal titles, and a scratchpad | Partial | Drafts have a title (RFC 013). Tags are Later (RFC 042). No scratchpad. | ORG |
| TF-046 | Add emoji with AI | Missing | Assist has three actions only: rewrite, thread, and shorten. | AI |
| TF-047 | Create LinkedIn drafts directly | Exists | The user picks the channels for each draft. | CHAN |
| TF-048 | Mastodon | Exists | `draftChannelLimits` includes `mastodon`. | CHAN |
| TF-049 | Write X long-form posts | Missing | The X limit is 280 in the composer and in Go. No X Premium setting. | XOPT |
| TF-050 | Emoji picker | Verify | The composer uses `createEditorKit` (`components/drafts/DraftEditor.tsx:583`). RFC 013 says that emoji stays on. Confirm a picker in the toolbar. | EDITOR |
| TF-051 | Discord and Telegram profile links | Skip | Depends on TF-015. | — |
| TF-052 | Quick change of the scheduled time | Exists | Reschedule in the composer (RFC 013, Scheduling a draft). | SCHED |
| TF-053 | Calendar view | Partial | A week view with drag (`components/drafts/DraftCalendar.tsx`). No month view. No filters. | SCHED |
| TF-054 | Drag and drop in the calendar | Partial | A drag changes the day only. It keeps the time. No swap. | SCHED |
| TF-055 | AI rewrite on all platforms | Exists | Assist takes the channel as input (`lib/content-drafts/assist.ts:45`). | AI |
| TF-056 | Complex custom AI prompts | Exists | The model comes from the platform registry (`lib/ai/models`). Custom instructions: see TF-070. | AI |
| TF-057 | Realistic preview for LinkedIn | Partial | A per-channel preview opens on demand. No collapsed "see more". No mobile view. | PREVIEW |
| TF-058 | Keep formatting on paste | Verify | Plate pastes HTML, and DOCX import works (RFC 013). Test a paste from Google Docs and from Notion. | EDITOR |
| TF-059 | Faster AI model | Exists | Assist uses `models.languageModel('fast')` (`lib/content-drafts/assist.ts:49`). | AI |
| TF-060 | Link previews for shared drafts | Missing | `app/[locale]/d/[token]/page.tsx` has no `generateMetadata`. | PREVIEW |
| TF-061 | Publish X long-form posts | Missing | See TF-049. | XOPT |
| TF-062 | Threads by Meta | Exists | `draftChannelLimits` includes `threads`. | CHAN |
| TF-063 | Configurable thread auto-split | Partial | The AI splits text into a thread. No setting for the maximum post length. | XOPT |
| TF-064 | Better auto-reposts | Partial | A repost waits for a like count and tries at 6, 12, and 18 hours (RFC 013). No repost after a set time. | FOLLOW |
| TF-065 | Weekly and monthly analytics grouping | Missing | No stored metrics history (RFC 042 P3). | ANALYTICS |
| TF-066 | X videos up to 10 minutes | Verify | One video per post exists. Check the upload limits of the X adapter. | XOPT |
| TF-067 | Bluesky | Partial | Bluesky publishes. It has no app-password form, so it connects through the API only (RFC 013). | CHAN |
| TF-068 | 20 MB images with auto-resize | Verify | Check the asset upload limit and any per-channel resize in the publisher. | MEDIA |
| TF-069 | "Publish now" for scheduled drafts | Missing | No immediate action. `parseWhen` reads relative times only (`lib/content-drafts/when.ts:45`). | SCHED |
| TF-070 | Custom instructions for AI | Partial | The workspace brand voice exists (`components/workspace/WorkspaceBrandSettings.tsx:264`). Draft assist does not read it. | AI |
| TF-071 | First comment on LinkedIn posts | Missing | RFC 042 P1, step 3. | LIOPT |
| TF-072 | Natural posting times | Missing | No random offset. Build it with the RFC 042 P2 "Spread" random shift. | SCHED |
| TF-073 | Publish to X Communities | Partial | The X adapter accepts a community URL (`services/internal/social/integrations/social/x/dto.go:16`). Drafts do not offer it. | XOPT |
| TF-074 | X long-form "Show more" in previews | Missing | Depends on TF-049. | PREVIEW |
| TF-075 | Auto-numbering on all platforms | Missing | See TF-020. | EDITOR |
| TF-076 | Mixed media on X posts | Missing | A video goes out alone, with no images beside it (RFC 013, Polls and video). | XOPT |
| TF-077 | LinkedIn company mentions | Missing | Mentions serialize as plain text (RFC 013, Serialization). | LIOPT |
| TF-078 | LinkedIn "...more" in previews | Missing | No cutoff in the preview. | PREVIEW |
| TF-079 | Revamped draft tags | Later | RFC 042, Later: "Draft tags and pinning". | ORG |
| TF-080 | Full-text draft search | Missing | `plainText` is stored for search (RFC 013), but the drafts rail has no search. | ORG |
| TF-081 | Drag and drop in the monthly calendar | Missing | RFC 042 P5 adds the month view. | SCHED |
| TF-082 | More sign-in options and a primary platform | Partial | Google and GitHub sign-in (`lib/auth/environment.ts`). No LinkedIn or X sign-in. Per-channel text exists. | CHAN |
| TF-083 | LinkedIn PDF carousels | Missing | No document upload in the LinkedIn adapter. | LIOPT |
| TF-084 | Drafts sidebar, queue board, empty slots | Missing | The calendar has no drafts sidebar and no board view. | SCHED |
| TF-085 | Exact preview cutoffs for X and LinkedIn | Missing | No cutoff in the preview. | PREVIEW |
| TF-086 | Draft locking | Exists | Live co-editing replaces locks (RFC 013, Collaboration; `services/internal/product/content_draft_collab.go`). | COLLAB |
| TF-087 | AI image descriptions | Missing | Depends on TF-007. | MEDIA |
| TF-088 | Public API, Zapier, MCP, and webhooks | Partial | REST `/api/v1/content-drafts` with `draft:write` keys exists (RFC 013). No MCP draft tools (RFC 026). No outbound webhooks. No Zapier app. | AGENT |
| TF-089 | X Community timeline toggle | Missing | Depends on TF-073. | XOPT |
| TF-090 | Draft activity log | Partial | Revisions and audit records exist (RFC 013). No activity view. | COLLAB |
| TF-091 | Raycast extension | Missing | Depends on TF-088. | AGENT |
| TF-092 | Reorder media in drafts | Missing | Posts reorder by drag (`components/drafts/thread.tsx:162`). Images inside a post do not. | MEDIA |
| TF-093 | Writing assistant | Partial | Three assist actions. No voice learning, no saved rules, no chat. | AI |
| TF-094 | Better LinkedIn mentions | Missing | Depends on TF-077. | LIOPT |
| TF-095 | @mentions in comments and Slack notifications | Partial | Editor comments support mentions (`packages/platejs-editor/src/ui/comment.tsx`). No notice to the mentioned person. Slack posts designs only (`components/workspace/WorkspaceIntegrations.tsx:23`). | COLLAB |
| TF-096 | Queue, mention, and quote endpoints for agents | Partial | Settings and best-times routes exist. No queue list for agents, no MCP tools. Draft scheduling by API key is Later (RFC 042). | AGENT |
| TF-097 | X content disclosures | Missing | RFC 042 P1 adds disclosures for TikTok only. | XOPT |
| TF-098 | LinkedIn reposts | Missing | No repost of a LinkedIn post URL. | LIOPT |
| TF-099 | Draft comments API | Missing | Only the guest route exists (`app/api/drafts/shared/[token]/comments`). | AGENT |
| TF-100 | Previews in the editor sidebar | Partial | The preview opens on demand in the composer. Not side by side. No mobile scale. | PREVIEW |
| TF-101 | Slack channel notification on publish | Partial | A Slack connection exists for designs. No publish event goes to Slack. | COLLAB |
| TF-102 | X Articles | Partial | The X adapter has `services/internal/social/integrations/social/x/article.go`. Drafts do not offer articles. | XOPT |
| TF-103 | Substack Notes | Missing | No Substack adapter in `services/internal/social/integrations/social`. | CHAN |
| TF-104 | Team calendar, planned drafts, navigation | Missing | Draft status is `draft`, `scheduled`, or `archived` (RFC 013). The calendar shows one workspace. | SCHED |
| TF-105 | 1080p video on X | Verify | Check the video upload of the X adapter. | XOPT |
| TF-106 | Official Claude connector | Missing | RFC 026 is Proposed. The MCP server has no draft tools. | AGENT |
| TF-107 | X reply settings | Partial | The X adapter accepts `who_can_reply_post` (`services/internal/social/integrations/social/x/dto.go:17`). Drafts do not offer it. | XOPT |
| TF-108 | Quote posts on more platforms | Missing | No quote of an outside post on any channel. | QUOTE |
| TF-109 | Polls on LinkedIn, Threads, and Mastodon | Missing | Go rejects them: "Polls are for X posts." (`services/internal/product/content_draft_schedule.go:240`). | POLL |
