# Cookie Policy and consent banner (draft)

> **DRAFT — requires counsel review.** Not legal advice. Do not publish. Shots has no cookie policy
> and no consent banner in code today. Code baseline: commit `bad06b3e`.

## Summary

- Shots uses a few necessary cookies for sign-in, and browser storage for the editor.
- PostHog analytics and Google AdSense set cookies that need consent in the EEA, the UK, and
  Switzerland.
- Product change P1 adds the consent banner. Do not publish this policy before P1 ships.
- The `NEXT_LOCALE` cookie in the live Privacy Policy is not in this list. The code does not set it.

## Banner requirements (product change P1)

1. Show the banner before PostHog or AdSense load, to visitors from the EEA, the UK, and Switzerland.
   `[[COUNSEL: decide whether to show it to all visitors]]`
2. Give "Accept all", "Reject all", and "Choose" the same weight. Reject must be as easy as accept.
3. Keep analytics and advertising off until the visitor opts in.
4. For AdSense in the EEA and the UK, use a Google-certified consent platform, as Google requires.
5. Honor the Global Privacy Control signal as an opt-out of "sale", "sharing", and targeted
   advertising for US visitors.
6. Add a **Your Privacy Choices** link to every footer. The link reopens the banner.
7. Record each choice with its time, the banner version, and the categories.
8. Ask again after `[[CONSENT RENEWAL PERIOD]]` or when the categories change.

---

## Proposed text

**Cookie Policy**

Version `[[VERSION]]`. Effective `[[EFFECTIVE DATE]]`.

### 1. What this policy covers

This policy explains the cookies and browser storage that Shots uses at `shots.playbookmedia.io`.
The [Privacy Policy](privacy-policy.md) explains how we use the data.

### 2. Your choices

- Use the **Your Privacy Choices** link in the footer to change your choice at any time.
- You can also block or delete cookies in your browser. If you block necessary cookies, you cannot
  sign in.

### 3. Necessary cookies

These cookies make sign-in and security work. They do not need consent.

| Name                                             | Purpose                                     | Lifetime                        | Party |
| ------------------------------------------------ | ------------------------------------------- | ------------------------------- | ----- |
| `[[CONFIRM: better-auth session cookie]]`        | Keeps you signed in                         | `[[CONFIRM: session lifetime]]` | First |
| `[[CONFIRM: better-auth two-factor cookie]]`     | Holds a two-factor challenge during sign-in | `[[CONFIRM: minutes]]`          | First |
| `[[CONFIRM: better-auth trusted-device cookie]]` | Skips two-factor on a device that you trust | 30 days                         | First |

### 4. Functional cookies

| Name                 | Purpose                                                            | Lifetime | Party |
| -------------------- | ------------------------------------------------------------------ | -------- | ----- |
| `shots-store-active` | Reopens your App Store screenshot project. Holds the value 1 only. | 1 year   | First |

### 5. Analytics cookies (consent required)

| Name                       | Provider | Purpose                                     | Lifetime             | Party                  |
| -------------------------- | -------- | ------------------------------------------- | -------------------- | ---------------------- |
| `ph_<project key>_posthog` | PostHog  | A pseudonymous ID for page views and events | 1 year `[[CONFIRM]]` | First (set by PostHog) |

PostHog also keeps the same ID in local storage.

### 6. Advertising cookies (consent required)

Google AdSense runs on public content pages only. It does not run in the editor or the workspace.

| Name                                        | Provider | Purpose                                        | Lifetime                      | Party                 |
| ------------------------------------------- | -------- | ---------------------------------------------- | ----------------------------- | --------------------- |
| `__gads`, `__gpi`, `__eoi`                  | Google   | Ad delivery, frequency limits, and measurement | Up to 13 months `[[CONFIRM]]` | First (set by Google) |
| `IDE`, `DSID`, and others on Google domains | Google   | Ad personalization and measurement             | Up to 13 months `[[CONFIRM]]` | Third                 |

See [how Google uses cookies in advertising](https://policies.google.com/technologies/ads).

### 7. Browser storage

The editor stores your work in your browser. This data stays on your device. Clear your site data to
remove it.

| Storage         | What it holds                                                                                           | How long                |
| --------------- | ------------------------------------------------------------------------------------------------------- | ----------------------- |
| IndexedDB       | Editor drafts                                                                                           | 7 days                  |
| IndexedDB       | App Store screenshot projects                                                                           | Until you delete them   |
| Local storage   | Imported images under 500 KB, export settings, presets, recent link previews, and small interface flags | Until you clear them    |
| Local storage   | The name that a store review guest enters                                                               | Until you clear it      |
| Session storage | The previous page, for the back button                                                                  | Until you close the tab |

### 8. Changes

We update this policy when we add or remove a cookie. We show the date at the top.
