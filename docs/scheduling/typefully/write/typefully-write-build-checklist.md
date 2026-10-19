# Typefully-like Write: implementation and verification checklist

Companion to [the functional reconstruction](typefully-write-spec.md). Everything below is **proposed engineering work**, not a report of tests passed by Typefully.

## Build sequence

| Phase | Deliverable | Completion evidence |
|---|---|---|
| 1 | Social-set selection, draft list, structured post editor, autosave, undo, properties | Create/edit/reopen a draft without content loss; correct account identity throughout |
| 2 | X and LinkedIn adapters, validation, platform selection, independent versions | Same draft produces correct thread and single-post representations |
| 3 | Media, polls, mentions, PDF carousel, previews | Valid assets render and serialize; invalid combinations are blocked clearly |
| 4 | Planned/scheduled/publish review, reliable publisher | Time and destination confirmed; one external publication per intended operation |
| 5 | Tags, pinning, copy/duplicate, activity, snapshots | Organizational changes preserve content and access rules |
| 6 | Sharing, anchored comments, editing locks | Two-user exercise proves authorization and overwrite prevention |
| 7 | Refine, Writing Assistant, templates | Suggestions apply to intended scope and preserve undo/comments |
| 8 | Auto-RT, Auto-Plug, Auto-DM | Controlled test accounts demonstrate idempotency, expiry, quota enforcement |

## Component inventory

- WriteShell: navigation and responsive regions.
- SocialSetSwitcher: stable IDs, platform indicators, connection health.
- DraftList: lifecycle tabs, search/filter/sort, pinning, selection.
- DraftRowMenu: duplicate, copy, share, backup, delete.
- DraftComposer: platform tabs and editor state.
- PostNodeView: identity, text, attachments, action bar.
- ArticleComposer: rich document and cover.
- MentionPicker: provider-aware lookup and atomic insertion.
- PollEditor: provider-specific schema and validation.
- MediaTray: upload/progress/error/reorder/alt text.
- PdfCarouselPreview: document pages and native overlay simulation.
- DraftProperties: title, scratchpad, tags, counts, activity.
- CommentRail: text anchors, threads, resolution, access rules.
- ShareDialog: internal and public access distinctions.
- RealisticPreview: platform, desktop/mobile, device dimensions.
- RefinePopover and WritingAssistantPanel.
- NumberingDialog and ThreadFinisherTemplates.
- PublishingReview and SchedulePicker.
- AutomationDialogs: retweet rules, engagement threshold, DM conditions.
- VersionBrowser: snapshot navigation and recovery to new draft.

## Suggested domain operations

Names are illustrative application commands, not Typefully endpoints.

| Operation | Required checks |
|---|---|
| CreateDraft | Set access; enabled destinations; kind; default snapshot |
| UpdateDraft | Write permission; revision token; valid node schema; comment integrity |
| DuplicateDraft | New identity; safe treatment of dates, shares, automation, external IDs |
| CopyDraftToSet | Source-read and destination-write permissions; destination capabilities; tag remapping |
| AddMedia | Ownership; type/size; processing state; attachment compatibility |
| UpdatePlatformVersion | Explicit sync/manual mode; no silent target overwrite |
| PlanDraft | Future time; timezone; publication remains disabled |
| ScheduleDraft | Valid content; healthy credentials; quotas; revision consistency |
| PublishDraft | Revalidate all prerequisites; idempotency key; per-platform result recording |
| EnableShare | Exact draft scope; random/revocable link; server authorization |
| AddComment | Anchor exists; permission; current revision; target sync policy |
| RecoverVersion | Preserve original; create new draft; strip publication identity |
| EnableAutomation | Published-source dependency; valid rule; explicit activation; expiry |

## Verification cases

### Editor and persistence

1. Type, navigate to another draft, return, and reload: content remains exact.
2. Save while typing quickly: out-of-order responses cannot restore older text.
3. Disconnect network: unsaved state is visible and eventual retry preserves edits.
4. Split at paragraph boundaries: text is not lost or duplicated.
5. Merge/delete/reorder a post: media and comments remain attached correctly.
6. Undo/redo a split, mention, poll, and template insertion.
7. Paste emoji, combining characters, URLs, and multiline text; counts stay correct.
8. Recover a backup: a new draft is created and the source stays unchanged.
9. Duplicate/copy: published IDs and active jobs are not accidentally inherited.
10. Same-name social sets remain distinct across every operation.

### Platform versions

11. Toggle editing focus without changing publishing enablement.
12. Sync an X thread to LinkedIn: post order and separators are correct.
13. Edit the LinkedIn version manually: further X edits follow the explicit sync policy.
14. Disable/re-enable a platform: unsent content and preferences are handled predictably.
15. Missing or expired connection: publication is blocked with a reconnect path.
16. Validate X account entitlement separately from the app's subscription.
17. X Article cannot coexist with ordinary destination versions if matching Typefully's documented restriction.

### Rich content and validation

18. Count generated numbering against limits; test every position/style/skip combination.
19. Mention selection is atomic across cursor movement, deletion, copying, and comments.
20. LinkedIn poll rejects missing question, invalid lengths, and too few/many options.
21. Poll/media conflicts are enforced in editor, API, and publish worker.
22. PDF carousel handles first/last page, page count, size, and processing failure.
23. Upload failures preserve text; failed media cannot silently publish as if complete.
24. Media reorder and cross-post movement preserve identity, alt text, and transforms.
25. Preview renders mention text, quoted content, and native truncation consistently.
26. Internal metadata and scratchpad never leak into publication payloads.

### Planning and publishing

27. Planned dates never trigger publishing jobs.
28. Confirming a planned draft schedules exactly the intended instant.
29. Editing slot templates does not alter existing scheduled timestamps.
30. DST gaps/repeated times and timezone changes have deterministic behavior.
31. Natural-time offsets remain stable across refresh and retry.
32. Simultaneous next-slot requests cannot incorrectly double-book a reserved slot.
33. Empty/over-limit/invalid-media drafts cannot bypass validation through shortcuts.
34. Double-click Publish or retry after timeout: no duplicate post.
35. One platform succeeds and another fails: retry targets only the unresolved work.
36. Partial X thread failure has an explicit compensation/recovery policy.
37. Cancellation racing with a worker produces an honest, reconcilable outcome.

### Sharing and collaboration

38. Internal links respect current set/team access.
39. Public-share disable/revocation blocks subsequent access, including cached routes.
40. Text edits preserve comment anchors or explicitly resolve invalid ones.
41. Users cannot edit another author's comment merely because they can edit the draft.
42. Two editors/tabs cannot silently overwrite one another.
43. A user losing access while a draft is open cannot save or publish afterward.
44. Copying a draft does not unintentionally copy public grants or private discussions.

### AI and automation

45. AI suggestion cancellation leaves text unchanged; acceptance is undoable.
46. Generation scope stays within the selected post/platform/selection.
47. AI output cannot bypass length, audience, media, or comment-anchor validation.
48. Retweet jobs wait for publication and are not duplicated on retries.
49. Auto-Plug triggers once per campaign even after repeated threshold crossings.
50. Auto-DM evaluates any/all conditions correctly and deduplicates recipients.
51. Daily DM quota and campaign expiry are enforced server-side.
52. Disabling a campaign stops pending work without undoing already completed external actions silently.

### UI and accessibility

53. Closing a nested dialog returns focus to its launcher.
54. Keyboard shortcuts do not execute publishing while a text field or modal owns the keystroke.
55. Tooltips, icon labels, and click targets identify the same action.
56. Loading states never expose implementation placeholder text.
57. Validation messages clear when the invalid block is undone or removed.
58. Device previews label decorative metrics as mock data or avoid analytics-like ambiguity.
59. Empty state, network error, and missing permission are distinguishable.
60. Responsive sidebars do not hide final-review account identity or destructive-action labels.

## Remaining discovery before claiming parity

Use disposable drafts and test accounts to establish exact autosave timing, restore retention, bulk operations, deletion recovery, upload transformations, article schema, live non-X/LinkedIn platforms, role permissions, free-plan gates, public-link behavior, and actual delivery/failure handling. The live inspection establishes visible controls and selected transitions; it does not substitute for these integration tests.
