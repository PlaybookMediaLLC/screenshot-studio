# Security page copy (draft)

> **DRAFT — requires counsel review.** Not legal advice. Do not publish. This draft corrects the copy
> in `components/platform-landing/pages/SecurityPage.tsx`. Code baseline: commit `bad06b3e`.

## Summary

- Most claims on the Security page match the code.
- Change four claims: the IP hashing claim, the training claim, the isolation test claim, and the
  provider list.
- Remove the self-hosting lines. Shots does not offer self-hosting (owner decision, 2026-10-17).
  The pricing page FAQ has the same claim (P16).
- Add a vulnerability reporting address and `security.txt` (P7).

## Claim review

Status values: **Keep** (the code supports it), **Fix** (change the words), **Hold** (publish only
after a product change), **Remove** (delete the line), **Owner** (a business decision).

| Section   | Live claim (short)                                                                                        | Status | Proposed copy or action                                                                                                                                                                     |
| --------- | --------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hero      | "The app can't edit the audit log"                                                                        | Keep   | No change.                                                                                                                                                                                  |
| Hero      | "your files sit in private storage for your workspace alone"                                              | Keep   | No change.                                                                                                                                                                                  |
| Hero      | "backed by code you can read"                                                                             | Owner  | Keep only if the repository stays public.                                                                                                                                                   |
| Access    | "SAML and OIDC, plus Google, Microsoft, and GitHub sign-in"                                               | Fix    | "SAML and OIDC single sign-on on Enterprise plans. Google, Microsoft, and GitHub sign-in where enabled." `[[CONFIRM: which sign-in providers production enables]]`                          |
| Access    | "Password sign-in can be switched off"                                                                    | Keep   | No change.                                                                                                                                                                                  |
| Access    | SCIM tokens "stored as hashes"                                                                            | Keep   | No change.                                                                                                                                                                                  |
| Access    | "A fresh two-factor session is required to configure SSO or SCIM and to connect social channels"          | Keep   | No change.                                                                                                                                                                                  |
| Access    | Fixed roles; approving and publishing are separate                                                        | Keep   | No change.                                                                                                                                                                                  |
| Access    | Sign-in limit per minute                                                                                  | Keep   | No change. The value comes from the code constant.                                                                                                                                          |
| Access    | API keys: "Five scopes, hashed at rest, shown once ... No key can approve or publish"                     | Keep   | No change.                                                                                                                                                                                  |
| Your data | "An ID from another workspace returns 404"                                                                | Keep   | No change.                                                                                                                                                                                  |
| Your data | Signed URLs "expire in two minutes", uploads "write-once"                                                 | Keep   | No change.                                                                                                                                                                                  |
| Your data | "Isolation, tested: An automated test with two workspaces proves ..."                                     | Fix    | "Automated tests with two workspaces check that logins and API keys cannot reach another workspace's releases or assets." Remove "proves".                                                  |
| Your data | "No database in the web app"                                                                              | Keep   | No change.                                                                                                                                                                                  |
| Your data | "Deleting a workspace starts a grace period. Afterward, a deletion record and the audit evidence remain." | Hold   | Publish after P2: "Deleting a workspace starts a 14-day grace period. Then we delete the workspace content. We keep a deletion record and audit records until their retention period ends." |
| Your data | "The application runs in the United States ... Regional data residency is not offered today."             | Fix    | Add: "Some providers process data in other regions. See the subprocessor list."                                                                                                             |
| Audit     | "The application's database role can insert and read audit rows and nothing else"                         | Keep   | No change.                                                                                                                                                                                  |
| Audit     | "IP addresses are stored as keyed hashes, not raw values."                                                | Fix    | "Audit records store a keyed hash of the IP address, not the raw value." Session records store the raw IP address for security.                                                             |
| Audit     | Retention 90 days, longer retention and legal hold on Enterprise                                          | Keep   | No change.                                                                                                                                                                                  |
| Audit     | Audit export: CloudEvents, HMAC SHA-256, Splunk and Datadog presets                                       | Keep   | No change.                                                                                                                                                                                  |
| Audit     | Export secrets "encrypted at rest with AES-256-GCM"                                                       | Keep   | No change.                                                                                                                                                                                  |
| Audit     | Exports "refuse private addresses and redirects"                                                          | Keep   | No change.                                                                                                                                                                                  |
| AI        | "No training on your content ... No model is trained on it."                                              | Fix    | Now: "We do not train models on your content." (owner confirmed). Add after P11 and counsel review: "Our AI providers do not train on it either." `[[COUNSEL: confirm the provider terms]]` |
| AI        | "It runs inside one workspace, holds no credentials, and can't approve anything."                         | Keep   | No change.                                                                                                                                                                                  |
| AI        | "Prompt and completion text are kept out of the audit log."                                               | Fix    | Add: "Your AI conversations are stored in your workspace until you delete them."                                                                                                            |
| Providers | "Self-hosting replaces any of them with your own."                                                        | Remove | Delete the sentence. Self-hosting is not offered.                                                                                                                                           |
| Providers | Ten providers                                                                                             | Fix    | Replace the table with a link to the [subprocessor list](subprocessors.md). The live table omits Stripe, Google AdSense, the AI model providers behind OpenRouter, and others.              |
| FAQ       | SOC 2 or ISO 27001: "Not today."                                                                          | Keep   | No change. Do not claim a certification until an auditor issues it.                                                                                                                         |
| FAQ       | Report a vulnerability through the contact page                                                           | Fix    | "Email `[[SECURITY EMAIL]]`. Read our [Responsible Disclosure policy](responsible-disclosure.md)." Requires P7.                                                                             |
| FAQ       | "Can we run it in our own cloud? Yes."                                                                    | Remove | Delete the question. Self-hosting is not offered.                                                                                                                                           |
| FAQ       | "Every read and write is scoped to your workspace."                                                       | Keep   | No change.                                                                                                                                                                                  |

## New lines to add

1. "Credentials for audit destinations, Slack, Notion, Figma, and app stores are encrypted at rest
   with AES-256-GCM."
2. "Social network tokens are encrypted at rest." Hold until P9.
3. "Report a vulnerability to `[[SECURITY EMAIL]]`. Our `security.txt` is at
   `/.well-known/security.txt`." Hold until P7.
