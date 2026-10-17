# Terms of Service — DRAFT

> **DRAFT — requires counsel review.** Not legal advice. Not published. Placeholders in
> `[[…]]` must be filled or removed before publishing. Replaces `app/[locale]/terms/page.tsx`
> (current text dated September 27, 2026).

## Summary

- These Terms are a contract between your organization and [[LEGAL ENTITY]], the company that
  runs Shots.
- Shots is a paid cloud service for making and publishing marketing content: an editor, AI
  drafting, campaigns, approvals and publishing to social networks.
- You own your content. You give us the rights we need to host it, process it (including with
  AI providers) and publish it where you tell us to.
- You are responsible for what you publish and for following each social network's rules.
- Plans renew automatically until you cancel. Cancelling takes effect at the end of the billing
  period.
- AI output can be wrong. Review it before you publish.
- There is no uptime guarantee unless a signed order form gives one.
- Our liability is capped. These Terms are governed by [[GOVERNING LAW]].

---

## Redline against the current page

| # | Current text | Change | Reason |
| --- | --- | --- | --- |
| 1 | ~~"By accessing and using Shots ("the Service"), you agree to be bound…"~~ | **Acceptance by checkbox at sign-up and checkout; the version accepted is recorded (§1).** | Acceptance by use alone is weak. No acceptance record exists today. [[PRODUCT: clickwrap + version record]] |
| 2 | ~~"Editing happens in your browser, and images you import are not uploaded to edit them."~~ | **Describe the cloud service (§2).** | False: signed-in projects, AI features and server rendering upload content. |
| 3 | ~~"Exporting sends the finished image to our compression endpoint… capturing a screenshot from a URL sends that address to a third-party capture service."~~ | **Moved to the Privacy Policy.** | Data-flow detail belongs in the Privacy Policy. |
| 4 | Four-item "you may not" list | **Replaced by the Acceptable Use Policy (§5).** | It did not cover spam, platform rules, scraping or AI misuse. |
| 5 | ~~"The images you create with Shots belong to you. We claim no ownership…"~~ | **You own your content, and you grant a limited licence to run the service (§6).** | We need a licence to host content, send it to AI providers and publish it. |
| 6 | ~~"The Shots software itself is open source and licensed under the Apache 2.0 license."~~ | **Open-source notice (§14).** | [[COUNSEL: confirm the licence of the Postiz-derived backend before stating a licence]] |
| 7 | AdSense clause | **Kept only if [[LEGAL ENTITY]] owns the AdSense account (§12).** | The publisher ID was added upstream; ownership is unverified. |
| 8 | No billing terms | **Plans, renewal, cancellation, refunds, taxes, non-payment (§9).** | Required for auto-renewal laws and Stripe disputes. |
| 9 | ~~"In no event shall Shots or its creator be liable…"~~ | **Named entity, conspicuous disclaimer, liability cap, indemnity (§15–17).** | No entity, no cap on direct damages, no indemnity. |
| 10 | ~~"Continued use of the Service after changes constitutes acceptance."~~ | **30 days' notice of material changes by email and in-app (§19).** | Silent changes are often unenforceable. [[PRODUCT: update notices]] |
| 11 | No governing law | **Governing law and disputes (§18).** | Missing. |
| 12 | No AI, publishing, API, termination or DMCA terms | **Added (§7, §8, §10, §11, §13).** | Missing. |

---

## Terms of Service

**Effective:** [[EFFECTIVE DATE]] · **Version:** [[VERSION]]

### 1. Who we are and how you agree

Shots is operated by [[LEGAL ENTITY]], [[ENTITY TYPE AND STATE]], [[ADDRESS]] ("we", "us").
These Terms govern your use of Shots, including the website, the web app, the API and any
related service (the "Service").

You accept these Terms by ticking the box at sign-up or checkout. We record which version you
accepted and when. [[PRODUCT: clickwrap + version record]] If you accept for an organization, you confirm you are authorized to bind
it. "You" then means that organization. A signed order form overrides these Terms where they
conflict.

### 2. The Service

Shots is a cloud service for making and publishing marketing content. It includes:

- an editor and design tools;
- workspaces, roles and approvals;
- AI drafting and review;
- asset storage;
- campaign planning;
- scheduling and publishing to connected social accounts;
- integrations such as GitHub, Slack, Notion and Figma [[OWNER: confirm which are enabled in
  production]];
- an API.

Most features process your content on our servers and with our providers. The
[Privacy Policy](/privacy-policy) and the [subprocessor list](/subprocessors) describe how.
Some features change over time. We will not remove a core feature you have paid for during your
current billing period without a pro-rata refund. [[OWNER: confirm this commitment]]

### 3. Eligibility

You must be at least 18 and use Shots for business or professional purposes. Shots is not
for consumers acting outside a trade or profession. [[COUNSEL: confirm whether to exclude
consumers entirely.]]

### 4. Accounts and workspaces

- Keep your sign-in details secure and turn on two-factor authentication where offered. You are
  responsible for activity under your account and your API keys.
- A workspace belongs to the organization that created it. Its owners and admins
  manage membership, roles and billing. Only the owner can delete the workspace or configure
  SSO/SCIM.
- If your organization uses SSO or SCIM, its identity provider decides who can sign in.
- Tell us promptly at [[SECURITY CONTACT]] if you suspect unauthorized access.

### 5. Acceptable use

You must follow the [Acceptable Use Policy](/acceptable-use). In short: no unlawful,
deceptive, infringing or harmful content; no spam; no breaking the rules of the platforms you
publish to; no attacks on or abuse of the Service.

### 6. Your content

"Your content" means what you or your members put into Shots: uploads, designs, text, brand
details, URLs, release notes, connected-account data, subscriber lists, and the outputs the
Service generates for you.

- **You own your content.** As between you and us, all rights in it stay with you.
- **Licence to us.** You grant us a worldwide, non-exclusive, royalty-free licence to host,
  copy, process, transmit, display and adapt your content only to provide, secure and support
  the Service for you. This includes:
  - sending it to the AI providers and subprocessors in the [subprocessor list](/subprocessors);
  - publishing it to the destinations you choose.
- We do not use your content to train AI models. We do not let our providers train on it either.
  [[PRODUCT: per-request no-training settings]] [[COUNSEL: confirm provider terms]]
- **Your responsibility.** You confirm you have the rights and consents your content needs.
  This includes consent from people on your subscriber lists, and rights in images, logos,
  trademarks and anything you capture from a URL.
- **Feedback.** You may send us suggestions. We may use them without obligation to you.

### 7. AI features

- AI features generate drafts, images, captions, critiques and plans using third-party models
  (listed in the [subprocessor list](/subprocessors)).
- **Output can be wrong, incomplete, or similar to content made for others.** Review every
  output before you rely on it or publish it. You are responsible for what you publish.
- As between you and us, you own the outputs generated for you, to the extent the law allows.
  We do not promise that outputs are protectable by copyright or free of third-party rights.
- Follow the [AI Use Policy](/ai), including disclosure of AI-generated content where a law or
  platform requires it.
- A workspace owner or admin can turn AI features off for the workspace.
  [[PRODUCT: kill switch on all AI endpoints]]

### 8. Publishing to third-party platforms

- When you connect a social account (X, LinkedIn, Instagram and others we add), you authorize us
  to act on that account within the permissions you grant. You can disconnect it at any time.
  [[PRODUCT: disconnect + provider revoke]]
- Nothing is published unless a member with approval rights approves the post and a member
  with publishing rights schedules it. [[PRODUCT: close the legacy `/postiz` public API and MCP
  routes, which bypass approval]]
- **You are responsible for your posts and for following each platform's terms.** If a
  platform rejects, removes, limits or delays a post, or suspends your account, that is between
  you and the platform.
- Platforms change their APIs and rules. We are not liable for platform outages, API changes,
  rate limits, or loss of access that we do not cause. We will make reasonable efforts to tell
  you when a platform change affects publishing.

### 9. Plans, billing and renewal

- **Plans.** Shots has no free plan. Prices are on the [pricing page](/pricing) and at checkout.
  As of [[EFFECTIVE DATE]]:
  - Pro is $199 a month or $2,028 a year.
  - Business is $699 a month or $7,128 a year.
  - Enterprise is quoted on an order form and billed annually.
- **Automatic renewal.** Monthly and annual plans renew automatically at the end of each period,
  at the then-current price, and charge the payment method on file, until you cancel.
  - We will tell you about price changes at least 30 days before they apply.
  - We will remind you before an annual renewal. [[PRODUCT: renewal reminder email]]
- **Cancelling.** Cancel at any time in Settings → Billing (the Stripe billing portal).
  Cancellation takes effect at the end of the current period. You keep access until then.
- **Plan changes.** Upgrades and downgrades are prorated by Stripe.
- **Usage limits and credits.**
  - Each plan includes monthly allowances. When you reach a limit, the action is refused until
    the next month or until you add credits. We do not bill overage automatically.
  - Extra credit packs ($29 for 500 credits) require a paid plan and do not expire while your
    workspace exists.
- **Refunds.** See the [Refund Policy](/refunds). Fees are otherwise non-refundable, except
  where the law requires a refund.
- **Taxes.** Prices exclude taxes unless stated. You pay applicable sales, use, VAT, GST or
  similar taxes. [[COUNSEL/OWNER: confirm the tax collection approach]]
- **Non-payment.** If a payment fails, we keep your plan active for up to 14 days while Stripe
  retries. After that, the workspace's features close until you pay.
  - We keep your data while the workspace exists.
  - You can still export your data. [[PRODUCT: export during lapse]]
- **Payment processing.** Stripe processes payments. We do not store card numbers.

### 10. API, MCP and automated use

Use of the API, API keys and any agent or MCP integration is also governed by the
[API Terms](/api-terms). Keys are scoped and rate-limited. You are responsible for every call
made with your keys.

### 11. Suspension and termination

- **By you.** Cancel your plan, or delete your workspace in Settings.
  - Workspace deletion has a 14-day recovery period. After that the workspace's data is purged,
    as described in the [Privacy Policy](/privacy-policy). [[PRODUCT: complete purge]]
  - You can delete your personal account in Settings. [[PRODUCT: account deletion]]
- **By us.** We may suspend access immediately if your use breaks the law, these Terms or the
  Acceptable Use Policy; risks harm to others or to the Service; or a platform requires it.
  - Where reasonable, we will tell you first and give you a chance to fix the problem.
  - We may terminate for material breach not cured within 30 days of notice, or for non-payment.
- **Effect.** On termination, your right to use the Service ends.
  - For 30 days we will let you export your content, unless the law prevents it or the
    termination was for serious abuse. [[PRODUCT: data export]]
  - After that we delete it, as described in the Privacy Policy.
  - Sections 6 (licence for retained copies only), 7, 9 (amounts owed), 15–18 and 20 survive.

### 12. Third-party services and advertising

- The Service connects to third-party services: social networks, Stripe, identity providers,
  GitHub and others. Their terms govern your use of them.
- Some public content pages show ads served by Google AdSense. You agree not to generate
  artificial ad impressions or clicks. [[OWNER: keep only if [[LEGAL ENTITY]] owns the AdSense
  account; otherwise delete this paragraph]]

### 13. Intellectual property and copyright complaints

- We own the Service, the Shots name and logos, and our documentation, except for open-source
  components and your content. [[OWNER: confirm ownership of the Shots name and any
  trademark]]
- We respond to notices of claimed infringement under our
  [Copyright Policy](/copyright).
- We terminate repeat infringers in appropriate cases.

### 14. Open-source notice

Parts of Shots come from open-source projects, including
[screenshot-studio](https://github.com/KartikLabhshetwar/screenshot-studio) by Kartik
Labhshetwar under the Apache License 2.0. Those components stay under their own licences, which
these Terms do not limit. [[COUNSEL: complete the list after the licence review, including any
Postiz-derived code and its licence; add a NOTICE/attribution page.]] [[OWNER: the repo test
`test/upstream-agent-boundaries.test.ts` keeps user-facing pages from linking to source
repos; decide whether this notice links to upstream or names it in plain text.]]

### 15. Disclaimers

THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE". TO THE EXTENT THE LAW ALLOWS, WE DISCLAIM
ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE,
TITLE AND NON-INFRINGEMENT.

WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED OR ERROR-FREE, THAT AI OUTPUT WILL BE
ACCURATE, OR THAT ANY THIRD-PARTY PLATFORM WILL ACCEPT OR KEEP YOUR CONTENT.

Unless a signed order form includes a service-level agreement, there is none. See the
[Support Policy](/support).

### 16. Limitation of liability

TO THE EXTENT THE LAW ALLOWS:

- (a) NEITHER PARTY IS LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL OR PUNITIVE
  DAMAGES, OR FOR LOST PROFITS, REVENUE, GOODWILL OR DATA. THIS APPLIES EVEN IF THE PARTY WAS
  ADVISED OF THE POSSIBILITY.
- (b) EACH PARTY'S TOTAL LIABILITY UNDER THESE TERMS IS LIMITED TO [[LIABILITY CAP — e.g. THE
  FEES YOU PAID US IN THE 12 MONTHS BEFORE THE CLAIM]].

These limits do not apply to your payment obligations, to either party's indemnity obligations,
or to liability that cannot be limited by law. [[COUNSEL: consider carve-outs for breach of
confidentiality and data protection obligations, with a separate super-cap.]]

### 17. Indemnity

- **You** will defend and indemnify us against third-party claims arising from your content,
  your posts, or your breach of these Terms or the Acceptable Use Policy.
- **We** will defend and indemnify you against third-party claims that the Service, as we
  provide it and excluding your content and AI output, infringes their intellectual property.
- The indemnified party must give prompt notice, reasonable cooperation, and control of the
  defence. [[COUNSEL: review scope.]]

### 18. Governing law and disputes

These Terms are governed by [[GOVERNING LAW]], without regard to conflict-of-laws rules.
Disputes will be resolved by [[DISPUTE MECHANISM]] in [[VENUE]]. Either party may seek urgent
injunctive relief in any competent court.

### 19. Changes to these Terms

- We may update these Terms. For material changes we will email workspace owners and show a
  notice in the app at least 30 days before the change takes effect, unless the change is
  legally required sooner. [[PRODUCT: versioned documents + update notices]]
- If you do not agree, you may cancel before the change takes effect. You will get a pro-rata
  refund of any prepaid fees for the remaining period.
- We record which version each account has accepted.

### 20. General

- **Entire agreement.** These Terms, the policies they link to, and any order form are the
  entire agreement.
- **Severability.** If a provision is unenforceable, the rest stays in effect.
- **No waiver.** Not enforcing a provision is not a waiver.
- **Assignment.** You may not assign these Terms without our consent, except to a successor to
  your business. We may assign them in a merger, acquisition or sale of assets.
- **Force majeure.** Neither party is liable for delays caused by events beyond its reasonable
  control.
- **Export controls and sanctions.** You will not use the Service in breach of export control
  or sanctions laws.
- **Notices.** We send notices to the workspace owner's email. Send notices to us at
  [[LEGAL NOTICES EMAIL]] and [[ADDRESS]].

### 21. Contact

[[LEGAL ENTITY]], [[ADDRESS]]. Email: [[LEGAL NOTICES EMAIL]]. General questions:
team@playbookmedia.io.
