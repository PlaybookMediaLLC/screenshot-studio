# Security page redline — DRAFT

> **DRAFT — requires counsel review.** Not legal advice. Not published. Proposed edits to
> `components/platform-landing/pages/SecurityPage.tsx` and two lines of
> `components/platform-landing/pages/EnterprisePage.tsx`. The audit report gives the evidence
> for each change.

## Summary

Most of the Security page is backed by code and tests. Three kinds of change are needed:

1. Change three claims that the code does not support yet: AI training, the audit-log
   guarantee, and who can see a workspace. Either change the wording or ship the product fix
   first.
2. Narrow eight claims to what the code does.
3. Replace the provider list with a link to the full subprocessor list.

The page's statement that Shots has no SOC 2 or ISO 27001 is accurate. Keep it.

## Edits

| Line | Current | Proposed | Reason |
| --- | --- | --- | --- |
| 259-260 | ~~"No training on your content. Your history is retrieved at generation time for your workspace only. No model is trained on it."~~ | **"No training on your content. We send AI providers only what a request needs, and our requests tell them not to store it or train on it."** | The no-training setting is not yet in the request code. Ship it before keeping this claim. [[PRODUCT: OpenRouter `data_collection: deny` / ZDR]] |
| 84 | ~~"The app can't edit the audit log"~~ | **"A database trigger blocks edits to the audit log. Only the retention job removes entries past your retention period."** | States the actual mechanism. [[PRODUCT: enforce the role grants in migrations]] |
| 204 | ~~"The application's database role can insert and read audit rows and nothing else."~~ | **Delete, or keep after the grants are in migrations.** | The grant is documented but not enforced in code. |
| 331 | ~~"Only your teammates, through the roles you assign."~~ | **"Your teammates, through the roles you assign. Our staff can see workspace metadata only with a time-limited support grant that you approve and that is recorded in your audit log."** | Support access exists. [[PRODUCT: owner approval for support grants]] |
| 37-51 | Provider table (10 vendors) | **"Shots runs on the providers in our [subprocessor list](/subprocessors)." Keep the table as a summary, and add Stripe, Infisical and the AI model vendors behind OpenRouter.** | The current list is incomplete. |
| 110 | ~~"Password sign-in can be switched off."~~ | **"Self-hosted deployments can switch off password sign-in. With SSO, members sign in through your identity provider."** | The switch is deployment-wide, not per workspace. |
| 120 | ~~"A fresh two-factor session is required…"~~ | **"Configuring SSO or SCIM, and connecting social channels, require two-factor authentication and a sign-in within the last 15 minutes."** | Exact rule. |
| 144 | ~~"Each request ends with an audit entry saved together with the change."~~ | **"Workspace changes are saved together with their audit entry. Identity-provider changes are audited right after they apply."** | SSO and SCIM audits are written after the change. |
| 175 | ~~"signed URLs that expire in two minutes"~~ | **"signed URLs that expire in two minutes. Links given to a social network to fetch your media last 24 hours."** | 24-hour delivery links exist. |
| 195 | "runs in the United States…" | **Append: "Some subprocessors, including AI providers, may process data outside the US; see the subprocessor list."** | Transfer disclosure. |
| 225 | ~~"Enterprise sets a longer period or places history on legal hold."~~ | **"Owners and admins can set a longer period or place history on legal hold."** or plan-gate it. | Not plan-gated on the server. [[OWNER: decide]] |
| 230 | "CloudEvents JSON over HTTPS…" | **Keep, and require HTTPS.** | HTTP endpoints are accepted today. [[PRODUCT]] |
| 252 | ~~"every action it takes is logged."~~ | **"Launch runs are logged with the model and token usage."** | Editor AI requests are not audited. |
| 314-321 | "Report vulnerabilities through the contact page" | **"Report vulnerabilities to [[SECURITY CONTACT]]. See our [disclosure policy](/security/disclosure) and `/.well-known/security.txt`."** | There is no formal policy today. |
| EnterprisePage 116, 147 | ~~"Configuring SSO or SCIM requires an owner or admin"~~ | **"Configuring SSO or SCIM requires the workspace owner"** | The code allows the owner only. |
| EnterprisePage 159 | ~~"Every audit event is sent to your security log tool as it happens."~~ | **"Audit events reach your security log tool within about a minute."** | Delivery is batched every minute. |

## Don't add yet

Do not add claims about the following until they are true and documented:

- encryption at rest beyond integration credentials;
- HSTS or CSP;
- backup RPO or RTO;
- penetration tests;
- uptime;
- required MFA;
- any certification.
