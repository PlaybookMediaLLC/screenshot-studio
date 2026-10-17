# Data Processing Addendum — DRAFT

> **DRAFT — requires counsel review.** Not legal advice. Not published. This is a short-form
> outline in plain language. Counsel should decide whether to adopt it, or to attach the EU
> Standard Contractual Clauses and UK Addendum in full.

## Summary

- This addendum covers personal data that customers put into Shots workspaces.
- The customer is the controller. [[LEGAL ENTITY]] is its processor (GDPR) and service provider
  (CCPA/CPRA).
- We process the data only to provide the Service, under the customer's instructions.
- We use the subprocessors on [/subprocessors](/subprocessors), with 30 days' notice of changes.
- We notify personal-data breaches without undue delay.
- When the customer deletes a workspace, we delete its data after a 14-day recovery period.
  [[PRODUCT: complete purge]]

**Parties:** [[LEGAL ENTITY]] ("Processor") and the customer named in the order form or account
("Customer"). **Effective:** the date the Customer accepts the Terms of Service, or signs this
addendum.

## 1. Scope and roles

1.1 This addendum applies to Customer Personal Data: personal data in content the Customer or
its members put into the Service, which the Processor processes for the Customer.

1.2 For Customer Personal Data, the Customer is the controller and the Processor is its
processor or service provider. The Processor is an independent controller for account, billing,
security and website data, as its [Privacy Policy](/privacy-policy) describes.

1.3 Annex 1 describes the processing.

## 2. Instructions

2.1 The Processor processes Customer Personal Data only on the Customer's documented
instructions. The Terms, this addendum, and the Customer's use of the Service's features
(including AI features and publishing) are those instructions.

2.2 The Processor will tell the Customer if it believes an instruction breaks data protection
law.

2.3 **CCPA/CPRA.** The Processor will not:

- sell or share Customer Personal Data;
- retain, use or disclose it outside the direct business relationship, or for any purpose other
  than the business purposes in Annex 1;
- combine it with other data, except as the law permits.

The Processor certifies that it understands these restrictions.

## 3. Confidentiality

The Processor ensures that personnel who access Customer Personal Data are bound by
confidentiality. Staff access is limited to what support, security or the law requires.
[[PRODUCT: support access approval flow]]

## 4. Security

The Processor implements the measures in Annex 2. It may update them, but not in a way that
materially lowers protection.

## 5. Customer responsibilities

The Customer:

- is responsible for the lawfulness of the data it puts into the Service, including consent for
  mailing-list subscribers;
- manages its members, roles and connected accounts;
- decides which content to use with AI features and where to publish.

## 6. Subprocessors

6.1 The Customer authorizes the subprocessors listed at [/subprocessors](/subprocessors).

6.2 The Processor will give at least 30 days' notice before adding or replacing a subprocessor.

6.3 The Customer may object on reasonable data-protection grounds within that period. The
parties will discuss in good faith. If they cannot resolve the objection, the Customer may
terminate the affected Service and receive a pro-rata refund of prepaid fees.

6.4 The Processor imposes data protection terms on each subprocessor that are no less
protective than this addendum. It remains responsible for its subprocessors.

## 7. International transfers

7.1 The application is hosted in the United States. [[REGION: database, Redis, object storage]]

7.2 For transfers of Customer Personal Data from the EEA, UK or Switzerland, the parties
incorporate:

- the EU Standard Contractual Clauses, Module 2 (controller to processor), with these
  elections: Clause 7 docking applies; Clause 9 option 2 (general authorization, 30 days); no
  Clause 11 option; Clauses 17 and 18 [[GOVERNING LAW / COURTS — e.g. Ireland]];
- the UK International Data Transfer Addendum;
- the Swiss amendments.

Annexes 1 and 2 complete the clauses. [[COUNSEL: confirm the elections; consider Module 3 for
onward transfers.]]

## 8. Assistance and data subject requests

8.1 The Processor will forward any data subject request it receives about Customer Personal
Data to the Customer, without responding itself unless the Customer authorizes it.

8.2 The Processor will give reasonable help with requests, DPIAs and consultations with
regulators. The Service's own tools are part of that help: workspace deletion, member removal,
and export. [[PRODUCT: export]]

## 9. Personal data breaches

9.1 The Processor will notify the Customer without undue delay, and no later than [[e.g. 72]]
hours after becoming aware of a breach affecting Customer Personal Data.

9.2 The notice will include what is known about the nature of the breach, the data and people
affected, the likely consequences, and the measures taken. The Processor will update it as
facts emerge.

## 10. Deletion and return

10.1 During the term, the Customer can delete content and export it. [[PRODUCT: export]]

10.2 When the Customer deletes a workspace, or the Agreement ends, the Processor deletes
Customer Personal Data within 14 days (the recovery period). [[PRODUCT: complete purge,
including connected-account tokens, projects and credentials]]

10.3 Backups expire within a further 14 days. [[OWNER: confirm backup retention]]

10.4 Exceptions:

- audit-log entries are kept for 90 days after the purge as security evidence [[PRODUCT/OWNER:
  decide whether the Customer's own period and legal hold should survive the purge]];
- the Processor may keep data it is legally required to keep, protected by this addendum.

## 11. Audits

The Processor will make available the information needed to show compliance with this
addendum, including answers to reasonable security questionnaires once a year. If that is not
enough, or a regulator requires it, the Customer may conduct an audit on 30 days' notice,
during business hours, at its own cost, under confidentiality. The Processor holds no SOC 2 or
ISO 27001 certification today. [[OWNER: update if that changes]]

## 12. Liability and order of precedence

Liability under this addendum is subject to the Terms' limitation of liability, except where
the law does not allow it. [[COUNSEL]]

For Customer Personal Data, this addendum prevails over the Terms. The SCCs prevail over both.

---

## Annex 1 — Description of processing

| Item | Description |
| --- | --- |
| Data subjects | The Customer's members; people in content the Customer uploads; the Customer's mailing-list subscribers; reviewers on shared links; people whose details appear in connected-account, GitHub or website data the Customer points the Service at |
| Categories of data | Names, emails, usernames, profile images; workspace roles and activity; audit logs (email, keyed IP hash, user agent); content (images, designs, text, posts); subscriber email, name and unsubscribe status; connected social account IDs and tokens; GitHub author usernames and PR content |
| Sensitive data | None intended. The Customer should not upload special-category data. |
| Nature and purpose | Hosting, storage, rendering, AI drafting and review, scheduling and publishing to Customer-chosen platforms, email delivery to the Customer's subscribers, audit logging and export to Customer-chosen tools, support |
| Frequency | Continuous |
| Duration | The term of the Agreement plus the deletion period in §10 |
| Subprocessors | See [/subprocessors](/subprocessors) |

## Annex 2 — Security measures

These are taken from the shipped code.

- **Access control.** Role-based permissions across six fixed roles, checked on the server for
  every API request. API keys are scoped to five permissions, rate-limited, and none of them
  can approve or publish.
- **Authentication.** Optional TOTP two-factor; required for sensitive actions such as SSO,
  SCIM and social connections. SSO (OIDC and SAML) and SCIM, with SCIM tokens stored as hashes.
  Sign-in rate limits.
- **Tenant isolation.** Queries for workspace content are scoped to the workspace. Workspace
  files sit in private object storage under a per-workspace prefix, with short-lived signed URLs.
  Automated tests check that one workspace cannot reach another's releases or assets. The web
  tier has no database credentials. (The public-URL screenshot cache is shared across
  workspaces.)
- **Encryption.** TLS in transit. Integration credentials, store-publishing credentials and
  audit-export secrets are encrypted with AES-256-GCM. [[PRODUCT: encrypt social tokens]]
  [[OWNER: confirm provider encryption at rest for the database and object storage]]
- **Logging.** An audit log blocked from updates and deletes by a database trigger. Retention
  is configurable, with legal hold. IP addresses are stored as keyed hashes. Export goes to
  Customer SIEM endpoints, with an HMAC signature (generic) or the vendor's token (Splunk,
  Datadog). [[PRODUCT: require HTTPS endpoints]]
- **AI safety.** Untrusted web content is fenced in prompts and checked for injection. SSRF
  protection applies to server-side fetches of user-supplied URLs.
- **Backups.** Database backups every 12 hours, with point-in-time recovery.
  [[OWNER: confirm the provider settings]]
- **Deletion.** Workspace deletion with a 14-day recovery period and audited purge.
- **Vulnerability management.** [[OWNER: describe dependency scanning, patching and the
  disclosure policy]]
