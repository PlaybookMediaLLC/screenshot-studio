# Privacy Policy — DRAFT

> **DRAFT — requires counsel review.** Not legal advice. Not published. Placeholders in
> `[[…]]` must be filled or removed before publishing. Replaces
> `app/[locale]/privacy-policy/page.tsx` (current text dated September 27, 2026).

## Summary

- Shots is a cloud service. Your account, your workspace's content, and the things you publish
  are stored on our servers and processed by the providers listed in our
  [subprocessor list](/subprocessors).
- For your workspace's content (assets, posts, subscriber lists, member activity) we act for
  your organization, as its **processor** or **service provider**. For account, billing, site
  analytics and security data we are the **controller**.
- We send content you choose to use with AI features to third-party AI models. We do not use
  your content to train models.
- We publish to the social accounts you connect, only after a member approves and schedules a
  post. [[PRODUCT: close the legacy `/postiz` public API and MCP routes]]
- Our application servers are in the United States. [[REGION: database, Redis, object
  storage]]
- We don't sell personal information. Where advertising cookies count as "sharing", you can opt
  out.
- You can access, export, correct and delete your data. Email [[PRIVACY CONTACT]].

---

## Redline against the current page

Every sentence below is false or outdated today. The audit report gives the evidence for each.

| # | Current text (line) | Change |
| --- | --- | --- |
| 1 | ~~"What stays on your device, what is sent to our server…"~~ (9) | **"How Shots collects, uses and shares personal information."** |
| 2 | ~~"Shots combines a browser-based image editor with a workspace platform…"~~ (89-91) | **"Shots is a cloud marketing platform…" (§1)** |
| 3 | ~~"Editing, compositing, and preview rendering happen on your device in the browser canvas."~~ (94-95) | **Deleted.** Designs are also rendered on our servers and by Cloudflare. |
| 4 | ~~"Several operations do send data off your device… export compression, URL capture, tweet import, and remote-image import…"~~ (95-97) | **Full list (§2).** |
| 5 | ~~"We do not sell your personal information."~~ (98-99) | **"We do not sell personal information for money. Advertising cookies may be 'sharing'; opt out at Your Privacy Choices." (§9)** [[COUNSEL]] |
| 6 | ~~"Images you import from your device are read in the browser and are never uploaded to us for editing."~~ (105-106) | **Deleted.** Signed-in projects and AI features upload images. |
| 7 | ~~"deleted automatically after 7 days"~~ (110-111) | **"cleared the next time you open the editor after 7 days"** |
| 8 | ~~"imported images under 500KB are kept in local storage… Larger images are held in memory only."~~ (114-116) | **"Unsaved drafts, including their images, are kept in your browser's IndexedDB." (§2.6)** |
| 9 | Preferences list (119-120) | **Adds reviewer name and link-preview history (§2.6).** |
| 10 | ~~"None of this reaches our servers."~~ (130) | **Deleted.** |
| 11 | ~~"Clearing site data in your browser removes all of it."~~ (130-131) | **"…removes the browser copies. Cloud copies stay until you delete them."** |
| 12 | ~~"we store your name, email… audit records, and the releases and assets"~~ (138-141) | **Full table (§2).** |
| 13 | ~~"Access to tenant data is scoped to workspace membership and role."~~ (141) | **Adds support access with customer approval (§6).** [[PRODUCT]] |
| 14 | ~~"Only public web pages you explicitly submit are captured."~~ (157) | **Discloses the onboarding and launch crawl (§2.4).** |
| 15 | AdSense section (187-237) | **Kept only if [[LEGAL ENTITY]] owns the AdSense account; moved to the Cookie Policy.** |
| 16 | ~~"We look at aggregate numbers, not at individuals."~~ (241-242) | **"PostHog assigns a device identifier…" (§2.5)** |
| 17 | ~~"when the deployment configures a PostHog key"~~ (246-247) | **Stated plainly.** |
| 18 | ~~"the deployment's hosting, storage, and network providers may process…"~~ (256-258) | **Providers named (§5).** |
| 19 | ~~"the screenshot API stores a one-way hash… for up to 60 seconds… The raw address is not used"~~ (261-263) | **Accurate IP handling (§2.5).** |
| 20 | ~~"We also set `NEXT_LOCALE`"~~ (270-271) | **Deleted.** It is not set. |
| 21 | `shots-store-active` (272-274) | **Moved to the Cookie Policy, with its 1-year lifetime.** |
| 22 | Third-party cookie list (277-286) | **Moved to the Cookie Policy.** |
| 23 | ~~"the other cookies are optional"~~ (289-290) | **"Non-essential cookies load only after you accept them." [[PRODUCT: consent banner]]** |
| 24 | ~~"a consent message from a Google-certified consent management platform… 'Privacy and cookie settings' link"~~ (295-303) | **Replaced by our own consent banner and a "Cookie settings" link. [[PRODUCT]]** |
| 25 | Legal bases (307-313) | **Per-purpose table (§3).** |
| 26 | ~~"Images you edit: not stored on our servers unless you save them to your workspace."~~ (319-321) | **Retention table (§7).** |
| 27 | Cached screenshots (324-325) | **Retention table (§7).** |
| 28 | ~~"Account and workspace data: kept while your workspace is active, then deleted after the displayed recovery period"~~ (328-330) | **Retention table (§7).** [[PRODUCT: complete purge + account deletion]] |
| 29 | ~~"Rate-limit entries: up to 60 seconds in Redis."~~ (332) | **"up to 1 hour"** |
| 30 | ~~"opt out using the advertising links above or by emailing us"~~ (347-349) | **"Your Privacy Choices" link and Global Privacy Control (§9).** [[PRODUCT]] |
| 31 | ~~"Clear site data… to remove every draft, image, and preference"~~ (363-364) | **Qualified (§8).** |
| 32 | ~~"Importing images from your device never leaves the browser."~~ (371-372) | **Deleted.** |
| 33 | Workspace deletion choice (376-378) | **Accurate deletion steps (§8).** |

---

## Privacy Policy

**Effective:** [[EFFECTIVE DATE]] · **Version:** [[VERSION]]

### 1. Who we are

Shots is a cloud marketing platform operated by [[LEGAL ENTITY]], [[ADDRESS]] ("we", "us").
It lets teams build product visuals, draft campaigns with AI, get approvals, and publish to
social networks.

This policy explains what personal information we collect, why, who we share it with, how long
we keep it, and your choices.

**Our role.**

- **Controller.** We decide how your account, billing, website, analytics and security data are
  used.
- **Processor / service provider.** For content a customer puts in its workspace, we act on the
  customer's instructions under our [Data Processing Addendum](/dpa). This covers assets,
  designs, posts, campaigns, brand details, subscriber lists, connected-account data, audit
  logs and members' activity in the workspace.
  - If you are a member of a customer's workspace, or on a customer's mailing list, that
    customer is responsible for that data. Send requests to them first.

### 2. What we collect

#### 2.1 Account and sign-in

- Name, email address, password (stored as a hash), profile image URL, and email-verified
  status.
- If you sign in with Google, GitHub or Microsoft, we receive your name, email and avatar from
  that provider and store the sign-in tokens it issues. [[OWNER: confirm which sign-in
  providers are enabled in production]]
- Two-factor authentication secrets and backup codes. Trusted-device markers.
- Session records, including **IP address and browser user agent**.
- For SSO and SCIM: your organization's identity-provider settings, and the user attributes it
  sends.
- API keys. We store a hash, plus the first characters so you can recognize the key.

[[PRODUCT/OWNER: the legacy social backend under `/postiz` keeps its own user records (email,
password hash, IP address). Remove that surface, or disclose those records here.]]

#### 2.2 Workspace content (we act for the customer)

- Workspace name, members, roles and invitations (invitee email).
- Uploads, designs, cloud projects and their versions, renders, captures, share links and
  review comments (including the name a reviewer types).
- Campaigns, briefs, product profiles, release notes, posts, approvals and schedules.
- AI chat messages.
- **Mailing-list subscribers** a customer imports: email, name, unsubscribe status.
- **Audit logs**: the acting member's email, a keyed hash of their IP address, user agent,
  request ID and what changed. Customers can forward audit logs to their own security tools.
- Credentials for integrations a customer connects: Slack, Notion, Figma, App Store Connect,
  Google Play. These are stored encrypted. [[OWNER: confirm which integrations are enabled in
  production]]

#### 2.3 Connected social accounts

When a member connects X, LinkedIn or Instagram (and other networks we add), we receive:

- the account's ID, name, username and profile picture;
- an access token, and a refresh token where the platform issues one.

We use the token only to publish the posts a member approves and schedules, and to check the
connection. We request these permissions:

- **X:** OAuth 1.0a user context.
- **LinkedIn:** `openid`, `profile`, `w_member_social`.
- **Instagram:** `instagram_business_basic`, `instagram_business_content_publish`.
  [[PRODUCT: remove unused comment and insight permissions, or list and justify them; remove
  the Facebook Login Instagram flow (which also requests `pages_show_list`,
  `pages_read_engagement`, `business_management`, `instagram_basic`,
  `instagram_content_publish`, `instagram_manage_comments`, `instagram_manage_insights`), or
  list those permissions here]]

Tokens are stored [[PRODUCT: encrypted]] and deleted when you disconnect the account or delete
the workspace. We also revoke them with the platform where it supports that. [[PRODUCT:
disconnect + revoke + purge]]

You can also revoke our access in each platform's own app or security settings. [[VERIFY:
current revocation paths for X, LinkedIn and Instagram]]

To delete Instagram/Facebook data we hold, use Settings → Channels → Disconnect [[PRODUCT:
disconnect]], or follow [[META DATA DELETION INSTRUCTIONS URL]]. [[PRODUCT: Meta data-deletion
callback]]

#### 2.4 Sources you point us at

- **URLs you submit.**
  - For screenshots and rendered page previews, the URL goes to Microlink, which loads the page.
    We cache screenshots with their URL.
  - For link previews, our servers fetch the page directly. If you choose, they identify as a
    named social or search crawler. [[PRODUCT/COUNSEL: crawler impersonation — see the AUP]]
- **Your product website.** During onboarding and launch drafting we read your homepage, its
  sitemap and up to four more pages (respecting robots.txt for those pages). We also read source
  URLs you provide, and keep excerpts with the draft.
- **GitHub.** [[OWNER: confirm the GitHub App is enabled in production]] If you install our
  GitHub App, we receive release notes and merged pull requests:
  title, description, labels, author username, changed file paths, and images in the
  description. We do not read your source code. We also read public GitHub pages you link.
- **Tweets.** For tweet import, we fetch the public post from X.

#### 2.5 Website, analytics and security

- **Analytics.** PostHog (US) records pages viewed, clicks, referrer, campaign parameters and
  device information. It uses a device identifier stored in a cookie and local storage for up
  to a year. We do not link analytics to your name or email.
  - Analytics loads only after you accept analytics cookies. [[PRODUCT: consent banner]]
  - We remove private link tokens from recorded URLs. [[PRODUCT: URL scrubbing]]
- **Advertising.** Some public content pages show Google AdSense ads, only after consent where
  the law requires it. [[PRODUCT: consent banner]] See the [Cookie Policy](/cookies). [[OWNER: keep only if [[LEGAL ENTITY]]
  owns the AdSense account]]
- **Security and abuse prevention.** We see IP addresses on every request.
  - We use a hash of the IP address to rate-limit requests, for up to 1 hour.
  - We store raw IP addresses in session records, and keyed hashes in audit logs.
- **Server logs.** Our hosting provider records request logs. [[OWNER: confirm log retention]]
- **Error reports.** [[OWNER: confirm whether Sentry is enabled in production. If it is, list
  it, and state that it may receive user ID and email.]]

#### 2.6 Stored in your browser

- **Unsaved editor drafts**, including their images, are kept in your browser's IndexedDB. A
  draft is cleared the next time you open the editor after it is 7 days old.
- **App Store screenshot projects** are kept in IndexedDB until you delete them.
- **Preferences**: export settings, presets, guides, dismissed banners.
- **Link-preview history**: your last 10 checked URLs.
- **Reviewer name**, if you leave a comment on a shared review link.
- **Downloaded model files** for in-browser background removal and video tools.

Clearing site data removes these browser copies. Copies saved to your workspace stay until you
delete them.

#### 2.7 Billing

Stripe collects your card, billing email, address and tax ID on its own pages. We store only
your Stripe customer and subscription IDs, your plan and status, and credit purchases.

#### 2.8 Email

We send sign-in, invitation and account email through Resend. If a customer sends release
announcements through Shots, Resend delivers them to that customer's subscribers. Each message
includes an unsubscribe link.

### 3. Why we use it (legal bases)

| Purpose | Data | Legal basis (GDPR / UK GDPR) |
| --- | --- | --- |
| Create and secure your account; provide the Service | Account, sign-in, workspace, content | Contract (Art. 6(1)(b)); for workspace content, on the customer's instructions |
| AI drafting and review you request | Content you use with AI features | Contract |
| Publishing you approve | Connected accounts, posts | Contract |
| Billing, taxes and records | Billing data | Contract; legal obligation (Art. 6(1)(c)) |
| Security, fraud and abuse prevention; audit logs | IP, sessions, audit logs | Legitimate interests (Art. 6(1)(f)): keeping the Service and customers safe |
| Product analytics | Analytics data | Consent (Art. 6(1)(a)) and ePrivacy consent for cookies |
| Advertising on content pages | Ad cookies | Consent |
| Service email | Email address | Contract; legitimate interests |
| Legal claims and compliance | As needed | Legal obligation; legitimate interests |

We do not make decisions with legal or similarly significant effects about you based solely on
automated processing.

### 4. AI processing

- When you use AI features, we send the content needed for that request to AI models through
  OpenRouter. This includes prompts, chat messages, brand voice, crawled site text, release
  notes, and images of your designs.
- As of [[EFFECTIVE DATE]] the models are Anthropic Claude (text and vision) and Google Gemini
  (image generation). The current list is on the [subprocessor list](/subprocessors).
- **We do not use your content to train AI models.** We configure our AI requests so that
  providers that train on or retain request data are not used. [[PRODUCT: OpenRouter
  `data_collection: deny` / ZDR]] [[COUNSEL: confirm the provider contract terms]]
- AI output can be wrong. Members review drafts before anything is published. See the
  [AI Use Policy](/ai).
- A workspace owner or admin can turn AI features off. [[PRODUCT: kill switch on all AI
  endpoints]]

### 5. Who we share it with

We share personal information only:

- with the **subprocessors** that run the Service, listed with purpose and location at
  [/subprocessors](/subprocessors);
- with **destinations you choose**: social networks you publish to, your identity provider,
  your security-log tools, your Slack/Notion/Figma workspace, App Store Connect and Google Play;
- with your **workspace owner and admins**, who can see members' activity and audit logs;
- if required by **law**, or to protect rights, safety and the Service;
- in a **merger, acquisition or sale of assets**, subject to this policy.

The main subprocessors are:

- DigitalOcean (hosting, US);
- PlanetScale (database);
- Upstash (Redis);
- Cloudflare (storage and rendering);
- Temporal Cloud (job scheduling, AWS US East);
- Resend (email);
- Stripe (payments);
- OpenRouter, with Anthropic and Google (AI);
- Microlink (screenshots);
- PostHog (analytics, US);
- Infisical (secrets management).

The browser loads files from Google Fonts, unpkg, jsDelivr and Hugging Face. Those providers
see your IP address.

### 6. Staff access

Our staff do not access workspace content except to provide support you request, to keep the
Service secure, or when the law requires it. Support access requires the workspace owner's
approval, is limited in scope and time, and is recorded in the audit log. [[PRODUCT: support
access approval flow]]

### 7. How long we keep it

| Data | Kept for |
| --- | --- |
| Account | While you have an account. Deleted within 30 days of account deletion. [[PRODUCT: account deletion]] |
| Workspace content | While the workspace exists. Purged 14 days after the owner deletes the workspace (the recovery period). [[PRODUCT: complete purge]] |
| Audit logs | 90 days by default. The workspace can set 30 to 3,650 days, or a legal hold. After workspace deletion, kept for 90 days as evidence. [[PRODUCT/OWNER: decide whether to keep the workspace's own period and legal hold after purge]] |
| Sessions | Until sign-out or expiry (7 days, extended while you are active) [[PRODUCT: sweep expired session rows]] |
| Connected social tokens | Until disconnect or workspace deletion [[PRODUCT: disconnect + purge]] |
| Billing records | As long as tax and accounting law requires: [[RETENTION: billing — e.g. 7 years]] |
| Cached URL screenshots | [[RETENTION: e.g. 30 days]] [[PRODUCT: scheduled cleanup]] |
| Rate-limit counters | Up to 1 hour |
| Analytics | [[RETENTION: PostHog project setting]] |
| Backups | Up to 14 days after deletion [[OWNER: confirm PlanetScale backup and PITR retention]] |

### 8. Your choices

- **Delete a workspace.** Settings → General → Delete workspace (owner only; type the
  workspace name to confirm). After a 14-day recovery period, the workspace's data is purged.
  [[PRODUCT: complete purge]] Backups expire within 14 days. [[OWNER: confirm]]
- **Delete your account.** Settings → Account → Delete. [[PRODUCT]]
- **Export.** Settings → Workspace → Export, or ask us. [[PRODUCT]]
- **Disconnect social accounts.** Settings → Channels. [[PRODUCT]]
- **Cookies.** Cookie settings (footer link). [[PRODUCT]]
- **Browser data.** Clear site data to remove the copies stored in your browser.
- **Email.** Use the unsubscribe link in any announcement.

### 9. Your rights

Depending on where you live, you can ask to:

- **access** your data, or get a copy (portability);
- **correct** it;
- **delete** it;
- **restrict** or **object** to processing, including processing based on legitimate interests;
- **withdraw consent** at any time.

- **How to ask.** Email [[PRIVACY CONTACT]] or use the in-app controls. We verify requests by
  confirming control of the account email.
  - You may use an authorized agent; we may ask for proof of authority.
  - We reply within one month (GDPR) or 45 days (US state laws), and say if we need to extend.
  - If we refuse, you may appeal by replying to our decision. We answer appeals within the time
    your law requires.
- **Data in a customer's workspace.** We pass your request to that customer and help them answer
  it.
- **US state privacy rights.** This covers California and other states with privacy laws.
  - We do not sell personal information for money.
  - Advertising cookies on our content pages may count as "selling" or "sharing" for targeted
    advertising. Opt out with the **Your Privacy Choices** link in the footer. We also honour
    Global Privacy Control signals. [[PRODUCT: GPC + opt-out link]] [[COUNSEL]]
  - We do not use sensitive personal information to infer characteristics about you.
  - We will not discriminate against you for using your rights.
  - Categories collected in the last 12 months:
    - identifiers;
    - customer records;
    - commercial information;
    - internet activity;
    - general location from IP address;
    - professional information.
  - Sources: you, your organization, the platforms you connect, and public websites you point us
    at. Purposes: those in §3.
- **Complaints.** You can complain to your data protection authority. In the UK that is the ICO.

### 10. International transfers

- We host the application in the United States. [[REGION: database, Redis, object storage]]
  Some providers may process data in other countries.
- When we transfer personal data from the EEA, UK or Switzerland, we rely on the EU Standard
  Contractual Clauses (with the UK Addendum and Swiss amendments), or another valid mechanism.
  [[COUNSEL: confirm the mechanism; [[DPA STATUS]] for each vendor; Data Privacy Framework
  certification, if any.]]

### 11. Security

We protect data with:

- role-based access in every workspace, checked on the server;
- private storage separated by workspace;
- encryption in transit [[PRODUCT: require HTTPS for audit-log exports]];
- encryption of stored integration credentials;
- two-factor authentication and SSO;
- append-only audit logs.

See [/security](/security). No system is perfectly secure. Report vulnerabilities as described
in our [disclosure policy](/security/disclosure).

### 12. Children

Shots is for business use by adults. You must be 18 or older to create an account. We do not
knowingly collect data from children. If you believe a child has given us data, contact
[[PRIVACY CONTACT]].

### 13. Changes

We will post changes here with a new effective date. For material changes we will email account
owners and show a notice in the app before the change applies. [[PRODUCT: update notices]]

### 14. Open source

Shots is open source under the Apache 2.0 license, so every claim on this page about how the
editor handles your images can be checked against its source code.

### 15. Contact

- [[LEGAL ENTITY]], [[ADDRESS]]
- Privacy requests: [[PRIVACY CONTACT]]
- Data protection officer: [[DPO/CONTACT]]
- EU representative: [[EU REPRESENTATIVE]]; UK representative: [[UK REPRESENTATIVE]]
  [[COUNSEL: confirm whether Art. 27 representatives are required]]
- General questions: team@playbookmedia.io
