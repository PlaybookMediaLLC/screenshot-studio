# Cookie Policy — DRAFT

> **DRAFT — requires counsel review.** Not legal advice. Not published. Depends on a consent
> banner that does not exist yet. [[PRODUCT: consent banner that blocks PostHog and AdSense
> until opt-in, honours Global Privacy Control, and adds a "Cookie settings" footer link]]

## Summary

- We use strictly necessary cookies to sign you in and keep you secure. These are always on.
- Analytics (PostHog) and advertising (Google AdSense, content pages only) are off until you
  accept them.
- Change your choice any time with **Cookie settings** in the footer.
- We honour Global Privacy Control as an opt-out of advertising cookies.

**Effective:** [[EFFECTIVE DATE]]

## What we use

### Strictly necessary (always on)

| Name | Set by | Purpose | Lasts |
| --- | --- | --- | --- |
| `__Secure-better-auth.session_token` | Shots | Keeps you signed in | 7 days |
| `__Secure-better-auth.state`, `…relay_state` | Shots | Protects Google, GitHub, Microsoft and SSO sign-in | 5 minutes |
| `__Secure-better-auth.two_factor` | Shots | Holds a pending two-factor check | 10 minutes |
| `__Secure-better-auth.trust_device` | Shots | Skips two-factor on a device you chose to trust | 30 days |
| `shots_oauth_<provider>` | Shots | Protects connecting Slack, Notion or Figma | 10 minutes |
| [[cookie name]] | Shots | Remembers your cookie choice | [[e.g. 12 months]] [[PRODUCT]] |

### Functional (always on; no identifier)

| Name | Set by | Purpose | Lasts |
| --- | --- | --- | --- |
| `shots-store-active` | Shots | Reopens your App Store screenshot project (value `1`) | 1 year |

### Analytics (off until you accept)

| Name | Set by | Purpose | Lasts |
| --- | --- | --- | --- |
| `ph_<project>_posthog` (cookie and local storage) | PostHog, on our domain | Counts visits and feature use with a random device ID | 1 year |

PostHog is a US company. See [posthog.com/privacy](https://posthog.com/privacy).

### Advertising (off until you accept; content pages only)

[[OWNER: keep this section only if [[LEGAL ENTITY]] owns the AdSense account.]]

| Name | Set by | Purpose | Lasts |
| --- | --- | --- | --- |
| `__gads`, `__gpi`, `__eoi`, `IDE` and others | Google | Serve and measure ads, cap frequency, prevent fraud; personalise ads if you allow | Set by Google; see Google's policy [[COUNSEL: confirm the names and lifetimes against Google's current list]] |

Ads never appear in the editor or workspace. See
[how Google uses information](https://policies.google.com/technologies/partner-sites), and opt
out of personalised ads at [Google Ads Settings](https://adssettings.google.com).

## Other browser storage

The editor stores unsaved drafts (with images), App Store screenshot projects, preferences and
downloaded model files in your browser's IndexedDB, local storage and cache. These stay on your
device and are needed for the features you use. See §2.6 of the
[Privacy Policy](/privacy-policy).

## Requests to other sites

Some pages load files from third parties, which see your IP address but set no cookies we know
of:

- Google Fonts (fonts in the editor and code tool);
- unpkg (video encoder);
- jsDelivr (face-detection and OCR engine files for redaction);
- Hugging Face (background-removal model).

## Your choices

- **Cookie settings** in the footer: accept or reject analytics and advertising.
- Global Privacy Control turns advertising cookies off.
- You can also delete cookies in your browser. Signing in needs the strictly necessary cookies.

## Contact

[[PRIVACY CONTACT]]
