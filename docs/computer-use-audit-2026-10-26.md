# Shots computer-use bug and UX audit — 2026-10-26

Status: audit pass documented; 13 confirmed functional/UX findings and one intermittent failure incident. The [implementation prompt](ui-ux-repair-prompt-2026-10-26.md) is ready. Production findings below were observed in the live app, not inferred from old test results. This is a record of defects and friction, not a claim that every possible bug has been found. Remaining coverage is explicit below.

## Environment and method

- Production: `https://shots.playbookmedia.io`, authenticated Solomon AI workspace, Chrome on macOS.
- Started October 26 local time; browser clock crossed into October 27 UTC.
- Browser interactions through the computer-use tool. A separate `🐛 Shots QA` tab avoids editing the user's open draft.
- Repository inspected for corroboration: branch `docs/computer-use-bug-audit-2026-10-26`, based on the existing `develop` checkout. Local code is not proof of the deployed revision.
- Billing visibly reports **No plan**. Basic drafting is accessible. Whether this workspace should have paid entitlement is unverified.
- No purchases, publication, provider authorization, credential changes, or deletion performed.
- Evidence directory: [screenshots and snapshots](product/qa-evidence/2026-10-26/). The production screenshots show a real workspace and account, so they are kept out of this public repository and the links to them resolve only in the auditor's local copy. The local-development screenshots in [after](product/qa-evidence/2026-10-26/after/) use test accounts and are committed.

## Findings

Journey health: **1. Enter/navigate — poor** (silent wrong destinations and context loss); **2. Create/write — poor in the live basic workspace, functional in the tested local paid paths**; **3. Find/reuse — impaired** (gated Library, filter race, vocabulary); **4. Review/import/schedule — mixed** (usable prerequisite checks, misleading import readiness, mobile overlap); **5. Deliver — unverified** (no safe connected provider in the live workspace).

### NAV-01 — P1: Home and screenshot creation silently send the user to Publish

1. Open the authenticated app on `/write`.
2. Click **Home** in the primary sidebar (href `/home`). Also tested opening `/home` directly.
3. Observe the final URL `/write` and the Publish screen.

Expected: a useful Home page, or navigation whose label accurately describes its destination. Actual: the user remains in Publish with no explanation, making Home look broken. The Shots Home logo uses the same destination.

Also reproduced through **New → Screenshot** and **New → Store screenshots**. Both settle on `/write` without opening an editor or explaining the restriction. [Store screenshot action result](product/qa-evidence/2026-10-26/21-new-store-screenshots-lands-publish.jpg). The editor root page uses the same unpaid landing redirect.

Corroboration: `app/[locale]/home/page.tsx` explicitly redirects unpaid access with `unpaidLandingPath`; `lib/auth/page-access.ts` resolves basic scheduling to `/write`. `PlatformSidebar` still offers Home as a normal destination. This is a navigation/entitlement UX defect; it does not establish a failed backend request.

### NAV-02 — P1: normal Create, Library, and Activity links eject users into pricing

1. From Publish click **Create**; wait for navigation to settle.
2. Return to Publish and click **Library**.
3. Both end at `/pricing?subscribe=required` rather than the named app section.

**Activity** was tested separately from Settings and reaches the same paywall.

Expected: communicate restricted access before the click and retain workspace context with an intelligible next step. Actual: unmarked sidebar links drop the entire app shell and lead to a generic marketing page. Library and Create cannot be exercised with the current entitlement.

The paid restriction itself is implemented intentionally in the local source (`requirePaidPageAccess`); the confirmed defect is the misleading navigation and loss of context. Do not fix this by removing server authorization.

Evidence: [Library → pricing](product/qa-evidence/2026-10-26/02-library-paywall.jpg). Create reached the same visible page; its first attempted capture was rejected because the tab had changed back to Publish before capture.

### UX-01 — P2: authenticated upgrade page looks signed out and loses the requested task

After NAV-02, the header offers **Sign in** and **Get started**. It has no workspace switcher, app sidebar, or contextual return to Create/Library. The banner says only “This capability requires a paid plan,” without naming the capability; the URL carries no return destination. The recovery link says “Start scheduling free,” even though the user was already signed in and trying to create/find visuals.

Expected: account-aware upgrade UI with the original task and a clear way back. Evidence: [pricing](product/qa-evidence/2026-10-26/02-library-paywall.jpg).

### BILL-01 — P2: Billing reports “No plan” instead of explaining available free access

1. Open **Settings → Billing** and wait for “Loading billing…” to disappear.
2. Observe “Choose a plan to start using Shots” and “No plan.”

Actual: the same workspace can draft in Publish, and pricing advertises a free basic scheduling plan. Billing does not explain that access, free quotas, or which capabilities are blocked. This makes the navigation failures difficult to diagnose and suggests the account is unusable.

Expected: show the actual effective tier/capabilities and upgrade restrictions coherently. Evidence: [billing state](product/qa-evidence/2026-10-26/03-billing-plan.txt), [screenshot](product/qa-evidence/2026-10-26/03-billing-plan.jpg).

### VIS-01 — P1: enabled composer controls and text are nearly invisible in light mode

1. Open a draft in Publish with the existing light appearance.
2. Inspect the draft title, Connect account button, publishing-brand name, selected Drafts tab, list excerpt, preview heading, and header icon actions.
3. Compare their appearance with the normal readable primary sidebar.

Actual: many enabled controls resemble disabled controls or disappear against the background. Header icons are dark against a charcoal strip; title text and connection guidance are very pale against white. The preview inherits the same problem. This is reproduced on desktop and at 390 × 844.

Read-only DOM measurement: both Draft title and Connect account have foreground `oklch(0.87 0 0)`, white `rgb(255, 255, 255)` background, and opacity 1. For neutral OKLCH this is approximately **1.48:1** contrast. These are enabled, meaningful controls, not intentionally disabled text.

Expected: shared theme tokens that provide readable text, icons, focus, and disabled states in each surface. Target at least 4.5:1 for normal text and 3:1 where applicable for meaningful non-text controls. Preserve accessible names; do not replace usable controls with static styling.

Evidence: [desktop composer/preview](product/qa-evidence/2026-10-26/08-draft-preview.jpg), [details](product/qa-evidence/2026-10-26/10-character-count-mismatch.jpg), [mobile composer](product/qa-evidence/2026-10-26/14-mobile-composer.jpg).

### MOB-01 — P2: fixed mobile formatting toolbar overlaps Add another post

1. Open the QA draft at 390 × 844.
2. Observe the editor at its initial scroll position.

Actual: the fixed bottom formatting toolbar covers the lower part of **Add another post**. The floating New draft button occupies the same toolbar area. The overlap competes with an editing action and reduces usable space.

Expected: reserve bottom space for the toolbar and safe area; ensure every action can be brought fully into view and activated without another control covering it. Evidence: [mobile composer](product/qa-evidence/2026-10-26/14-mobile-composer.jpg).

### UX-02 — P2: secondary composer controls dominate the first screen

On the phone viewport, the first line of draft text begins around y=600. Before it are two headers, connection guidance, platform controls, automatic numbering, closing templates, audience, auto-DM, character limit, split-on-paste, thread conversion, and copy. The bottom toolbar adds another large set of controls. On desktop, opening a preview produces four simultaneous columns/regions: global navigation, draft library, editor, preview.

Expected: make the writing area and current account/platform the primary task; group advanced automation/media/thread options behind clearly named controls. Keep save state and publication safeguards visible. The main editor must remain useful with preview open.

Evidence: [desktop](product/qa-evidence/2026-10-26/08-draft-preview.jpg), [mobile](product/qa-evidence/2026-10-26/14-mobile-composer.jpg). This is an observed UX finding, not a claim that every secondary feature is defective.

### NAV-03 — P2: successful link checks erase the return destination

1. Open **Campaign deliveries → Link checks**. The URL includes `returnTo=/write/deliveries?set=…`; **Return to your work** is visible.
2. Preview `https://linear.app` and let it complete.
3. The URL becomes `/link-preview?url=https%3A%2F%2Flinear.app%2F` and **Return to your work** disappears.

Expected: merge preview query parameters while preserving the validated return path and publishing-brand scope. Actual: completing the task loses its parent workflow. The normal Publish navigation also uses unscoped URLs here.

Evidence: initial and resulting URL/DOM observations in this audit; [successful result](product/qa-evidence/2026-10-26/13-link-previews-success.jpg). Reproduce with any successful link preview entered from a scoped parent screen.

### UX-03 — P2: inconsistent naming makes destinations difficult to find

- Primary navigation says **Publish**, page titles say **Write**, and much of the UI says **Drafts**.
- **Publishing brands** contains **New social set**, **New private social set**, and **New workspace social set**. Calendar says **Back to social sets**, while other screens call these accounts or brands.
- Open global **Search and commands**, type `draft`: it returns **No destinations match**, even though drafting is a core accessible workflow. Search only indexes destination names and offers no obvious alias for Drafts/Write.

Expected: one user-facing name per concept, useful aliases for common task words, and clearly labeled workspace/brand/account scope. Do not claim global content search exists if only destinations are searched.

Evidence: [command search](product/qa-evidence/2026-10-26/20-command-search-draft.jpg), [Calendar](product/qa-evidence/2026-10-26/11-calendar-week.jpg), live Publishing brands settings.

### UX-04 — P3: implementation details leak into workflow setup

**Automate → New workflow** describes the unavailable recurring template using “period deduplication (RFC 041) is not built yet.” **Sources** explains “Legacy intake,” “automation mode,” and fallback routing before helping a user connect a repository.

Expected: explain supported triggers, prerequisites, and outcomes in product language. Keep implementation/RFC details in developer documentation. Offer a clear connection prerequisite before presenting configurations that cannot be completed.

Evidence: [workflow templates](product/qa-evidence/2026-10-26/04-workflow-templates.jpg), [sources](product/qa-evidence/2026-10-26/06-workflow-sources.jpg).

### CAL-01 — P3: today's column shifts the Calendar time grid

1. Open Calendar, select Week, with Monday October 26 as the current day.
2. Compare hour labels across columns.

Measured button top positions: Monday 00:00/09:00/12:00 = 214/754/934; Tuesday and Saturday = 206/746/926. Today's hour rows are consistently **8 px lower**. The current-day header height changes the grid origin.

Expected: identical times share one horizontal grid regardless of the current-day badge. Evidence: [measurements](product/qa-evidence/2026-10-26/22-calendar-row-alignment.json), [screenshot](product/qa-evidence/2026-10-26/22-calendar-row-alignment.jpg). No incorrect stored schedule was demonstrated.

### IMPORT-01 — P2: import review marks invalid channels and missing connections as ready

1. Open Publish → Bulk import and enter this CSV:

```csv
caption,asset,channels
"QA import preview only. Do not publish.",,x
"QA invalid channel",,not-a-channel
```

2. Click Review import in a publishing brand with no connected accounts.
3. Both rows say **Ready to import** and **Create remaining drafts** is enabled. The review does not display the channel values.

Expected: validate known channel names and connection prerequisites during review, show the affected field and repair action, and distinguish a valid unassigned draft from an invalid channel request. Do not label an invalid row ready. Actual import was deliberately not submitted.

Corroboration: `lib/write/bulk-import.ts` splits/lowercases channel strings without checking membership; `components/write/bulk-import.tsx` defers account resolution until creation, where it throws `No connected ${channel} account in this set.` The bug is late/misleading validation, not proof of unauthorized delivery.

Evidence: [review screenshot](product/qa-evidence/2026-10-26/24-bulk-import-invalid-channel.jpg), [snapshot](product/qa-evidence/2026-10-26/24-bulk-import-invalid-channel.txt). Preview rows remain only in the audit tab's session storage; no drafts were imported.

### FILTER-01 — P2: a removed filter returns when search starts immediately

1. In Publish's draft list, set Filters → Kind → Article.
2. Click **Remove Article filter**, then immediately type `QA keyboard` into Search drafts.
3. After navigation settles, the Article chip returns alongside the search chip; the existing QA post is excluded.

Reproduced twice, with `QA audit` and `QA keyboard`. Waiting for filter removal to settle before typing succeeds; Clear filters also recovers the list.

Expected: the latest intended query state wins; typing a search must not restore a removed filter. Cover rapid filter/search changes, clearing, back/forward, and scoped brand navigation.

Corroboration: the debounced search in `components/write/library.tsx` calls `setQuery`; `components/write/write-context.tsx` combines asynchronous `router.replace` for filters with synchronous `history.replaceState` for search, reading `window.location.search` each time. An in-flight filter navigation and the old location can race. This is a plausible mechanism to confirm with a regression test, not a proven deployed-code trace.

Evidence: [settled race result](product/qa-evidence/2026-10-26/26-filter-removal-race.jpg), [snapshot](product/qa-evidence/2026-10-26/26-filter-removal-race.txt).

## Failure incidents requiring follow-up

### LINK-01 — intermittent link-preview failure and weak recovery message

Previewing `https://shots.playbookmedia.io/` showed **Unable to fetch preview → The operation was aborted**. `https://linear.app/` subsequently returned a 93/100 result and 13 platform previews. The first failure is captured in [screenshot](product/qa-evidence/2026-10-26/12-link-preview-aborted.jpg) and [snapshot](product/qa-evidence/2026-10-26/12-link-preview-aborted.txt).

The second attempt succeeded with a 46/100 result. The UI reported a redirect to `/sign-in` and lost tracking parameters. Evidence: [successful retry](product/qa-evidence/2026-10-26/23-own-preview-retry.jpg), [snapshot](product/qa-evidence/2026-10-26/23-own-preview-retry.txt). This is an intermittent failure with an unhelpful raw error, not a consistently broken checker. Improve retry guidance and investigate crawler/public-landing behavior separately. The successful retry also reproduced NAV-03.

## Retested observations that must not be counted as bugs

- **80 vs 67 characters:** the test string accidentally joined `publish.QA`, which the X parser treats as a URL. X counts that URL as 23 characters, explaining the 13-character difference. The copied text and Draft details both correctly contain 67 characters. The screenshot filename records the original suspicion; it is not proof of a broken counter. A visible explanation of platform-weighted counting would help.
- **Blank workflow selected a template:** an initial pointer interaction produced that state, but a fresh page followed by keyboard activation opened the correct Blank workflow form. Do not report blank creation as broken on this evidence. Repository connection remains a real prerequisite.
- **Bulk automation text insertion missing:** one automation insertion method produced no body text. Normal sequential typing and a normal clipboard paste worked, saved, copied correctly, and survived reload. No user-facing paste-loss claim is established.
- **Console storage errors:** logs include a Chrome extension content-script source; they are not attributed to Shots without isolation evidence.
- **Initial disabled settings controls:** brand fields became enabled after loading; this was not a permanent disabled-state defect.
- The first Create screenshot/snapshot captured Publish after a state change and is rejected as proof of a pricing redirect.

## Coverage and limits

| Flow | Observed result | Remaining |
| --- | --- | --- |
| Home / New Screenshot / New Store screenshots | Redirect to Publish | Paid-editor state blocked |
| Create | Redirects to pricing | Editor/tools blocked through this entry |
| Library | Redirects to pricing | Projects/assets/templates blocked |
| Activity | Redirects to pricing | Feed blocked |
| Settings → General | Opens on desktop/mobile; existing values visible | Settings mutations not performed |
| Settings → Billing | Loads, reports No plan | Effective entitlement needs reconciliation |
| Publish | Created one QA draft; title/body save, reload, copy, preview, details work | No provider connected; publication not attempted |
| Draft filters / bulk import | Normal filters/search work; rapid removal race and invalid ready rows reproduced | Actual import not submitted |
| Automatic backups / comments | Backup list and comparison render; Comments panel opens | No restore or comment sent |
| Repurpose published content | Invalid URL keeps Start writing disabled with provider guidance | No external content imported |
| Notifications / workflow run history | Empty states load and filters open | Populated histories not tested |
| Audit log / integrations | Settings pages open and integration inventory renders | No connection or audit retention changes |
| Schedule dialog | Opens; no platform blocks confirmation; Today chooses a future time | No actual schedule sent |
| Draft platforms | Shows supported provider connection choices | No OAuth permission granted |
| Media library picker | Opens; empty state points to composer/Create | No upload; Create entry gated |
| Calendar | Week view, drafts sidebar, stored view preference work | No live schedules; row alignment defect |
| Analyze / posting times | Clear no-account/no-measurement states | Populated analytics untested |
| Campaign deliveries | Empty state renders | Campaign creation/release workflow inaccessible |
| Link checks | Invalid URL rejected; Linear and own-domain retry work | Intermittent own-domain failure; batch/crawler modes untested |
| Automate | Empty list, templates, blank form, Sources open | No repository connected; activation/provider run untested |
| Settings search | Filters sections by `brand` | Global command search lacks `draft` alias |
| Brand settings | Voice and visual-kit forms load | No existing values changed or AI invoked |
| Product pages | Empty list/form; blank submit focuses required Name | No capture submitted |
| Channels / Publishing brands | Empty accounts, brand detail and connection options load | No third-party connection authorized |
| Mobile | Composer, preview, menu, navigation, General settings inspected at 390 × 844 | No physical-device or Safari verification |
| Release to provider receipt | Not tested | Paid access and safe provider fixture required |

Test data left for reproducibility: one draft named **QA audit — navigation and composer — 2026-10-26**, ID `cmvq0ld4800030azw0bjlnee4`, with an explicit “Do not publish” body. The user's pre-existing Untitled draft was left untouched. The viewport override was reset.

No fixes or deployment are included. Dark appearance was observed later in the session and is more legible; the agent did not change the theme. Full accessibility compliance, cross-browser behavior, paid production workflows, media/export, authenticated capture, security/admin mutations, and external delivery are not established. The current production account cannot prove the full release-to-approved-provider-receipt story from the repository skill. The absence of those tests is not a pass.

## Local paid-fixture follow-up

Started the documented Docker environment with `PLATFORM_AI_SCRIPTED=1 make up`. Its smoke check passed and it seeded `dev@localhost.test` in Playbook Dev with local paid access. No production entitlement changed. Local Home and Create both render successfully. Local behavior is evidence about this checkout, not a guarantee about the deployed revision.

Additional local outcomes:

- Screenshot editor: Start with text → edit text → Save as project succeeded. The new project appeared in Library and reopened with its text intact. Project `cmvq1l6zj000201lhmxioc171`, **QA local audit — 2026-10-26**. [Saved editor screenshot](product/qa-evidence/2026-10-26/28-local-saved-project.jpg).
- JPEG export was invoked and the popover closed, but the browser tool timed out waiting for a download. A browser-policy restriction prevented opening the downloads page. The actual file/content/dimensions remain **unverified**; neither an export success nor an app export defect is established.
- Store screenshots: Start from scratch, rename, browser-save indicator, and Checks panel worked. The local-browser fixture is **QA local store audit — 2026-10-26**. No store upload or provider export performed.
- Canvas: Blank canvas created a saved workspace document, rename succeeded, artboard selection and Edit layers made editing tools available. Fixture `c58677e28122b412386fbef87`, **QA local Canvas audit — 2026-10-26**. Advanced layer edits/export were not exercised.
- Campaigns: blank submit focused required Product name; adding a local product and release created a Draft campaign with the entered brief. Fixture `cmvq1tdcn000c01lhhzvgvtok`, **QA audit campaign — do not publish**, product **QA local audit product** with the public example URL. Review correctly remained disabled without copy. Draft spec completed with the scripted local model, produced v1 with source citations and open questions, and kept the spec in Draft. [Spec result](product/qa-evidence/2026-10-26/29-local-campaign-spec.jpg), [snapshot](product/qa-evidence/2026-10-26/29-local-campaign-spec.txt). No approval, plan generation, content delivery, or external publication was performed.

The first local tab was also being used by the user, so intermediate unexpected navigations there were excluded as evidence. The user requested a hidden tab; neither the in-app hidden browser nor Chrome visibility control is available. Remaining local checks used a new separate QA tab. The stack is left running for the user's local work; no volume reset or cleanup was performed.

Product-policy discrepancy to resolve: `company.md` describes no free plan, while the deployed pricing page advertises basic scheduling free and the current account can use it. Reconcile policy, flags, billing copy, and actual entitlement; do not invent a new tier or remove authorization as an audit fix.

## Repair status — 2026-10-26 (local, not deployed)

Verified against the local Docker stack (`next dev` on this checkout) with a paid fixture (`dev@localhost.test`) and a fresh free-basic-scheduling workspace, through a Playwright harness. Production is unchanged and unverified.

| ID | Fix | Regression check | Local result |
| --- | --- | --- | --- |
| NAV-01 | Home renders for free basic scheduling; paid starters say Pro. The bare `/` lands on Home; `/` with a project or store-studio query names the editor on the plan page. New menu marks paid items Pro and opens the plan page. | `test/e2e/typefully-free.spec.ts` (landings now expect `/home`) | `/home` → `/home` for the free workspace |
| NAV-02 | Every paid gate (`requirePaidPageAccess`, Activity, Assets, Campaigns, the proxy gate for image tools) sends a signed-in workspace to the in-app `/upgrade?from=<path>`, never to public pricing. Sidebar marks Create, Campaigns, Library, Automate and Activity Pro before the click. Server authorization is unchanged. | `test/sign-in-gate.test.ts`, `test/platform-navigation.test.ts` (`paidCapability`), e2e above | `/create` → `/upgrade?from=%2Fcreate` inside the app shell |
| UX-01 | `/upgrade` keeps the sidebar and account, names the capability ("Library is on Pro"), lists what Free and Pro include, offers Back to Publish, Choose a plan (owners/billing admins) and Compare plans. A workspace that already pays is sent on to `from`. | e2e above | Screenshot reviewed |
| BILL-01 | Billing names the free plan "Free basic scheduling" and lists what it includes and what needs Pro. | — | Copy change |
| VIS-01 | Composer, draft list, preview and Publish rail use theme tokens instead of dark-only `text-white`/`neutral-*`/`border-white` classes (pale accent text gets a dark shade in light mode). | — | [Before](product/qa-evidence/2026-10-26/after/30-before-light-publish-contrast.jpg) / [after](product/qa-evidence/2026-10-26/after/31-after-light-composer.jpg) |
| MOB-01 | The formatting bar is one scrollable row on phones, sits above the safe area, and the editor scroll area reserves room for it. | — | 390 × 844: Add another post and the New draft button are clear of the bar |
| UX-02 | Thread and automation settings (numbering, closing posts, audience, auto-DM, characters per post, split on paste, make thread, copy) sit behind **Post options**, which remembers its state per browser and opens on paste. Writing starts ~150 px higher on phones. | e2e storage state opens Post options so existing composer specs keep reaching the controls | Desktop and phone screenshots reviewed |
| UX-03 | Visible "social set" copy is "publishing brand"; Publish pages are titled Publish. Destination search understands task words (draft, write, screenshot, billing…) and says it finds places, not content. | `test/platform-navigation.test.ts` (`matchesDestination`); renamed e2e assertions | — |
| UX-04 | Automate drops "RFC 041", "legacy intake" and "automation mode" for product language. | — | Copy change |
| NAV-03 | Successful, failed and retried link checks keep a validated `returnTo` and the brand `set`. | `test/link-preview.test.ts` | Return link survives success, error, retry, reload |
| FILTER-01 | One pending query state that every filter/search change merges into; a search during an in-flight filter navigation replaces it instead of restoring the stale URL. | `test/write-library-query.test.ts` | Remove Article + type immediately ends at `?q=…` with no Article chip |
| IMPORT-01 | Review rejects unknown channels and channels with no connected account in the brand, shows each row's channels and the fix; invalid rows are not created. Unassigned rows stay valid. | `test/write-bulk-import.test.ts` | `x` and `not-a-channel` rows flagged; nothing imported |
| CAL-01 | Week-view day headers have a fixed height, so today's badge no longer shifts its column. | step in `test/e2e/plan-analyze.spec.ts` | All seven `00:00` buttons at the same y |
| LINK-01 | Fetch timeouts surface as "The source took too long to respond." with Try again that keeps the URL. Timeouts and SSRF checks unchanged. | `test/safe-fetch-deadline.test.ts` | — |

Found and fixed while using the app after the audit fixes:

- Card-sized buttons (workflow templates) were drawn as ellipses by the pill style; pills now apply only to one-line actions.
- A platform chip with no account read "Main version · off"; it now says "not connected". The schedule dialog's "Turn on at least one platform" now says to connect or turn on an account.
- Bulk import's raw file inputs ran into their labels ("CSV fileChoose File"); fields are labelled and styled, and the CSV box shows an example row.
- Automate opens on free plans but its runs need Pro; the page now says so with a link to plans instead of failing later.
- Link checks' Publish tabs kept no brand scope and never marked Link checks current; both fixed.
- Home's screenshot and Canvas previews never rendered. `next.config.ts` still made `/home` cross-origin isolated (COEP), left over from upstream's editor-at-`/home`. That made Chrome block the non-isolated `/render/local` preview frame (`net::ERR_BLOCKED_BY_RESPONSE`), so every Home preview stayed loading. The rule was removed (Home runs no FFmpeg) and `test/home-isolation.test.ts` guards it. Production uses the same config and likely has the same symptom; not verified there.

Shell design, as requested after the audit fixes:

- Tokens: the signed-in app uses the landing page's own global tokens (the `platform-theme.css` override was removed). Light mode keeps the same token file's light values.
- Type: Polar's typography with Polar's fallback face, variable Inter with Inter Display optical sizes (PP Neue Montreal is licensed): 450 body weight, 0.015em tracking, medium-weight headings, sentence-case section labels. Page headers use Polar's two-tone headline (title plus a short muted tagline) and span the full panel width.
- Sidebar: Polar's structure. Logo with notifications and search icons; 32px rows; a free-plan card; Documentation, theme and collapse controls; and one workspace-and-account switcher at the bottom. Icons are Polar's set, Material Icons Outlined, from the already-installed `react-icons` (`components/platform-shell/icons.ts`).
- Studio pages: Home, Create, Campaigns, Automate and Library follow a Dribbble-style creative studio. Category pills; 4:3 gallery thumbnails with a hover title shade; posts, campaigns and starting points drawn as windows on the landing page's grain stage; and a themed empty state per area (`components/platform-ui/empty-scenes.tsx`). Category bars stay pinned while the gallery scrolls, every thumbnail has a hairline frame so a white canvas still reads as a shot, and every template offers the same "Use template" action. Shell and studio-page icons are Material; the editors keep their own tool icons.
- Multi-page work: Canvas starters, Create's starting points, Brand resources, Story Set formats and the Story Sets empty state draw their pages as a fanned deck on the grain stage (`components/platform-ui/page-spread.tsx`), the direction chosen from the three compared (filmstrip, fanned deck, contact sheet). Pages keep their real shapes (16:9, 1:1, 4:5, 9:16) and show a miniature of what each page holds. At rest the deck sits loose, with a page count, so every page's edge and shape shows; hovering fans it along an arc with page numbers, the page under the pointer comes to the front with a ring and a lit number, and a glass card at the back marks where the next page goes. Canvases with several artboards sit on a stack of their page edges, which spreads a little on hover. Canvases with several artboards have page tabs on their cover: hovering, focusing or clicking a number shows that artboard in place, without opening the canvas. The tabs end in a Pages button (also "Manage pages…" in the card menu) that opens a page manager (`components/canvas-workspace/CanvasPages.tsx`): the canvas's real artboards in a grid at their shapes, numbered and named; drag a page to reorder it (an insertion bar shows where it lands) or use its earlier/later arrows from the keyboard; duplicate or delete it from its toolbar; add a blank page the size of the last. Changes save together through `canvas.updateDocument` against the revision the manager opened with, so an edit made elsewhere in the meantime is refused, never overwritten. Page order is the artboards' order, which printing and covers already follow. The grid opts out of the site-wide image drop zone (`data-local-dropzone`), which otherwise turns every drag into a refused "copy". Covered by `canvas.spec.ts` test F. A Story Set format that has not rendered shows a ghosted page with its name, and the Library and Story Sets empty states show a spread of the work they will hold. Three directions were compared first: a filmstrip (Canva's page navigator), a fanned deck, and the contact sheet (Canva's grid view); the sheet won because it shows count, formats and content without interaction and stays legible at card size.
- Motion: dialogs, menus, popovers and tooltips fade without zooming, and pressed buttons no longer shrink.
- Kaneo polish (from its `apps/web/src/index.css`): hairline tile borders that firm up on hover with depth from shadow in dark mode; 44px touch targets for small icon controls (`touch-hitbox`); hover-only controls kept visible on touch screens; fades without slides under reduced motion; autofill that keeps a field's own colours; thin scrollbars on inner scroll areas. Its fonts and colour tokens were not taken, because the app keeps Polar's typography and the landing page's tokens.
- Composer prose (`components/drafts/draft-prose.css`, scoped by `draft-prose` on the draft body): type stays Polar's like the rest of the app (450 body weight, open tracking, 500-weight headings without tightening, sentence-case labels; 16px on phones so iOS does not zoom). Kaneo's editor styles supply the rest: compact heading sizes, a quiet 2px quote bar, bordered and rounded inline code and code blocks, a fine link underline, softer list markers, and rounded slash and mention menus with layered shadows.
- Labels across the app are sentence case, as in Polar: `uppercase` utility labels inside the shell render as written, without their wide tracking. Plate tags every node `slate-<type>`, so the vendored editor package is not edited.

Evidence: [after screenshots](product/qa-evidence/2026-10-26/after/).

Test data left locally: a draft "QA composer — do not publish…" in Playbook Dev, and a free workspace "QA Free …" for `qa-free-…@example.test`.

Still open:

- The app's own `/` redirects signed-out crawlers to `/sign-in` and drops the query string, so own-domain previews score low and lose tracking parameters. Needs a public page at `/` for signed-out visitors or a query-preserving redirect.
- Policy: `company.md` says there is no free plan, while billing and pricing ship free basic scheduling. The UI now describes the shipped behaviour; the policy text still needs reconciling.
- Not verified: production, Safari or physical devices, actual JPEG export output, provider delivery.
- Local dev only: with two browser tabs on the `next dev` server, Turbopack keeps sending a `restart` for the root client entry, so both tabs reload every few seconds. Reproduced on signed-out `/pricing` as well as `/home`, so it is not the shell; the entry holds only `instrumentation-client.ts`, consent, analytics scrubbing and canvas diagnostics, none changed here. It makes e2e runs flaky while another `localhost:3000` tab is open; close other tabs before running the suite. Not investigated upstream.
- `dev/studio e2e` stops the design renderer and does not restart it. After a run, `PLATFORM_DESIGN_RENDERER=enabled docker compose --env-file .local/dev.env --profile renderer up -d app render-browser` restores template and project previews.
- Composer bugs found by making the e2e suite pass locally, all fixed:
  - **First paste into a new draft was lost.** An empty draft puts the caret on the post's void header; Slate ignores a paste on a non-editable target, so nothing was inserted. The editor now moves the caret into the post's text (`leaveHeader`, shared with typing) and inserts the paste once. Pre-existing at HEAD.
  - **Redo (Cmd/Ctrl+Shift+Z, Ctrl+Y) did nothing in drafts.** The Yjs redo stack was intact (`editor.redo()` worked), but a plugin in Plate's key pipeline claimed the shortcut, so Slate never redid. The editor handles the redo shortcut itself. Pre-existing at HEAD.
  - **Comments opened as an inline floating form over the text.** This was a regression from left-aligning the post column: Plate's `overlapWidth` (580px) was tuned to the old centred column. It now follows the new 42rem measure, so narrower editors open threads in the popover again.
  - Stale specs updated: the scheduling spec now unchecks "Open a new draft after scheduling" (default since #308), and the composer specs place the caret through the DOM (`caretAtDocumentEnd`) rather than `ControlOrMeta+End`, which does nothing on macOS.
- Passing locally after the redesign, on a warm dev server: `platform-redesign` (11), `workspace-switching`, `typefully-free`, `typefully-editor`, `typefully-long-form`, `content-drafts`, `write`, `campaign-qa`, `campaign-copilot`, `projects`, `session-access`, `workspace-settings`, `notification-feeds`, `plan-analyze`, `social-connection-picker`, `workspace-creation-dialog`, `settings-platform`. Unit tests 1131/1131. Runs right after a dev-server restart can time out while Next compiles a route (the asset content route took 94s cold); long runs bloat the dev server to 4–6 GiB, so restart it between large batches.
