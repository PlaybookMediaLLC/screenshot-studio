# Subprocessors — DRAFT

> **DRAFT — requires counsel review.** Not legal advice. Not published. Built from the code and
> production config at commit `70f4951a`. Before publishing:
>
> - confirm the live DigitalOcean env, because settings made by hand there may enable more
>   vendors;
> - fill in each `[[REGION]]`;
> - record which DPAs and SCCs are signed.

## Summary

These companies process personal data for Shots. We give 30 days' notice before adding or
replacing one. Customers on the [DPA](/dpa) can object.

**Last updated:** [[EFFECTIVE DATE]]

Vendor names are brands. [[COUNSEL: list the contracting entity from each signed DPA.]]

## Infrastructure

| Subprocessor | Purpose | Data | Location | DPA / transfer mechanism |
| --- | --- | --- | --- | --- |
| DigitalOcean | Application hosting | All Service data in transit; request logs | United States (New York) | [[DPA STATUS: DigitalOcean]] |
| PlanetScale | Primary database | All stored Service data | [[REGION: PlanetScale]] | [[DPA STATUS: PlanetScale]] |
| Upstash | Redis: rate limits, caching | Hashed IP addresses, cache entries | [[REGION: Upstash]] | [[DPA STATUS: Upstash]] |
| Cloudflare | R2 object storage; Browser Rendering for designs | Uploads, designs, renders, captures | [[REGION: Cloudflare R2 jurisdiction]] | [[DPA STATUS: Cloudflare]] |
| Temporal | Temporal Cloud: scheduling and background jobs | Workflow inputs (IDs; some email content) | United States (AWS US East) | [[DPA STATUS: Temporal]] |
| Infisical | Secrets management | Service credentials (no customer content) | [[REGION: Infisical]] | [[DPA STATUS: Infisical]] |

## Service features

| Subprocessor | Purpose | Data | Location | DPA / transfer mechanism |
| --- | --- | --- | --- | --- |
| OpenRouter | AI model gateway | Prompts, chat, brand details, crawled text, design images | [[REGION: OpenRouter]] | [[DPA STATUS: OpenRouter]] |
| Anthropic (via OpenRouter) | Text and vision models | As above | [[REGION: Anthropic]] | [[DPA STATUS: Anthropic]] |
| Google (via OpenRouter) | Image generation (Gemini) | Image prompts, colour palettes | [[REGION: Google]] | [[DPA STATUS: Google]] |
| Microlink | Screenshots and rendered link previews | URLs you submit | [[REGION: Microlink]] | [[DPA STATUS: Microlink]] |
| Resend | Transactional and announcement email | Recipient email, names, message content | [[REGION: Resend]] | [[DPA STATUS: Resend]] |
| Stripe | Payments and billing | Billing contact, payment method, tax ID, workspace ID | [[REGION: Stripe]] | [[DPA STATUS: Stripe]] |
| PostHog | Product analytics (with consent [[PRODUCT: consent banner]]) | Device ID, pages, clicks, IP | United States | [[DPA STATUS: PostHog]] |
| Google | AdSense on public content pages (with consent [[PRODUCT: consent banner]]) | Ad cookies, IP, page URL | Global | [[OWNER: list only if [[LEGAL ENTITY]] owns the account]] |

## Destinations you choose (not subprocessors)

These receive data only when you connect them, under their own terms:

- X, LinkedIn and Meta (Instagram), for publishing;
- your SSO or SCIM identity provider;
- Google, GitHub or Microsoft sign-in;
- the GitHub App [[OWNER: confirm enabled]];
- Slack, Notion and Figma [[OWNER: confirm enabled]];
- App Store Connect and Google Play;
- your audit-log destination (a custom endpoint, Splunk or Datadog).

## Files loaded by your browser

Google Fonts, unpkg, jsDelivr and Hugging Face serve fonts and model files. They see your IP
address but receive no content.

## Changes

We post changes here and email the account owners of customers on the DPA at least 30 days in
advance. Subscribe with [[SUBPROCESSOR NOTICE SIGNUP]]. To object, email [[PRIVACY CONTACT]]
within that period. [[COUNSEL: align the objection remedy with the DPA §6.]]
