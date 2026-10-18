# Subprocessors (draft)

> **DRAFT — requires counsel review.** Not legal advice. Do not publish. Shots has no subprocessor
> page today. Code baseline: commit `bad06b3e`.

## Summary

- This page lists the companies that process personal data for Shots.
- We give `[[NOTICE PERIOD]]` days of notice before we add or replace a subprocessor.
- A customer can subscribe to notices and can object under the
  [Data Processing Addendum](data-processing-addendum.md).
- Rows marked `[[CONFIRM]]` need a check of the live configuration or the vendor contract.
- Counsel confirms the contracting entity of each vendor. It can differ by region.

## Why this page is needed

1. The DPA gives customers a right to know and to object to subprocessors.
2. The live Security page lists ten providers. It omits Stripe, Google AdSense, and the AI model
   providers behind OpenRouter.

---

## Proposed text

**Subprocessors**

Last changed `[[DATE]]`.

### Infrastructure and service providers

| Subprocessor                            | What it does for Shots                                    | Personal data it receives                                       | Location                    | DPA           |
| --------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------- | --------------------------- | ------------- |
| DigitalOcean, LLC                       | Hosts the web application and the backend                 | All data that the service processes                             | United States (New York)    | `[[CONFIRM]]` |
| PlanetScale, Inc.                       | Runs the main database and its backups                    | All stored account and workspace data                           | `[[REGION: PlanetScale]]`   | `[[CONFIRM]]` |
| Cloudflare, Inc.                        | Stores files (R2) and renders designs (Browser Rendering) | Uploaded files, rendered images, design content                 | `[[REGION: Cloudflare R2]]` | `[[CONFIRM]]` |
| Upstash, Inc.                           | Runs Redis for rate limits, usage meters, and caches      | Hashed client addresses, workspace IDs, usage counts            | `[[REGION: Upstash]]`       | `[[CONFIRM]]` |
| Temporal Technologies, Inc.             | Runs scheduled publishing and maintenance workflows       | Record IDs and workflow state                                   | United States (AWS US East) | `[[CONFIRM]]` |
| Resend, Inc.                            | Sends account, invitation, and announcement email         | Email addresses, names, message content                         | `[[REGION: Resend]]`        | `[[CONFIRM]]` |
| Stripe, Inc.                            | Takes payments and runs the billing portal                | Billing contact, payment method, plan, invoices                 | `[[REGION: Stripe]]`        | `[[CONFIRM]]` |
| OpenRouter, Inc.                        | Routes AI requests to model providers                     | Prompts, workspace context, website text, canvas images         | `[[REGION: OpenRouter]]`    | `[[CONFIRM]]` |
| Anthropic, PBC (through OpenRouter)     | Runs the default text models                              | The same data as OpenRouter, for each request                   | `[[REGION: Anthropic]]`     | `[[CONFIRM]]` |
| Google LLC (through OpenRouter)         | Runs the default image model                              | Image prompts and reference images                              | `[[REGION: Google]]`        | `[[CONFIRM]]` |
| PostHog, Inc.                           | Product analytics                                         | Pseudonymous ID, page views, clicks, product events, IP address | United States               | `[[CONFIRM]]` |
| Microlink                               | Captures screenshots and reads link previews              | The web addresses that you submit                               | `[[REGION: Microlink]]`     | `[[CONFIRM]]` |
| Infisical, Inc.                         | Stores deployment secrets                                 | Service credentials. No customer personal data is expected.     | `[[REGION: Infisical]]`     | `[[CONFIRM]]` |
| `[[CONFIRM: support mailbox provider]]` | Receives email to our support address                     | Email content and contact details                               | `[[REGION]]`                | `[[CONFIRM]]` |

### Independent third parties on our website

These companies act as independent controllers. They are not our subprocessors.

| Company              | Where                     | What they receive                  |
| -------------------- | ------------------------- | ---------------------------------- |
| Google LLC (AdSense) | Public content pages only | Cookies, IP address, pages visited |

### Files that your browser downloads from third parties

Your browser downloads these files directly. The provider receives your IP address and a standard
file request. It does not receive your files.

| Provider     | When                                    |
| ------------ | --------------------------------------- |
| Hugging Face | First use of background removal         |
| unpkg        | First video export or video compression |
| jsDelivr     | First use of the redaction scan         |
| Google Fonts | When the editor shows a Google font     |

⚑ Product change P14 can remove these rows by serving the files from our own domain.

### Services that you connect

When you connect one of these services, we send it the content that you choose. Each one is your
choice and follows its own terms. They are not our subprocessors.

- Social networks: X, Instagram, Facebook (for Instagram), and LinkedIn.
- Delivery: Slack, Notion, and Figma.
- Store uploads: App Store Connect and Google Play.
- Source intake: GitHub.
- Audit log destinations: Splunk, Datadog, or your own endpoint.

### Change notices

1. To get notices, email `[[PRIVACY EMAIL]]` with the subject "Subprocessor notices", or
   `[[SUBSCRIBE MECHANISM]]`.
2. We email subscribers at least `[[NOTICE PERIOD]]` days before a new subprocessor starts.
3. In an emergency, for example a provider outage, we can make a change at once. We then send
   notice as soon as we can.
4. Each change appears in the table below.

| Date       | Change                     |
| ---------- | -------------------------- |
| `[[DATE]]` | First version of this page |
