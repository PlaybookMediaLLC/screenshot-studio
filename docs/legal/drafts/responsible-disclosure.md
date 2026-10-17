# Responsible Disclosure Policy — DRAFT

> **DRAFT — requires counsel review.** Not legal advice. Not published. Proposed for
> `/security/disclosure`, with a `/.well-known/security.txt` (body below). Neither exists
> today.

## Summary

Found a security problem in Shots? Email [[SECURITY CONTACT]]. Test only against your own
account. Don't access other people's data. Give us time to fix the problem before you publish.
If you follow these rules, we won't take legal action against you.

**Effective:** [[EFFECTIVE DATE]]

## In scope

- `shots.playbookmedia.io` and its API, including `/api/v1`.
- The open-source code in our public repository.

## Out of scope

- Denial of service and load testing.
- Social engineering and phishing.
- Physical attacks.
- Spam.
- Findings in third-party services we use; report those to the vendor.
- Missing best-practice headers with no demonstrated impact.
- Automated scanner output without a working proof.

## Rules

- Use only accounts you own, or have permission to test.
- Don't access, change or delete other users' data. If you reach it by accident, stop, and tell
  us what you saw.
- Don't degrade the Service.
- Give us [[e.g. 90]] days to fix the problem before you disclose it publicly. We can agree a
  different timeline together.

## What we do

- We acknowledge your report within [[e.g. 3 business days]].
- We keep you updated while we fix it.
- We credit you if you want credit.
- [[OWNER: state whether there is a bounty. Default: no monetary rewards.]]

## Safe harbour

If you act in good faith and follow this policy:

- we consider your research authorized;
- we will not pursue legal action against you under anti-hacking or anti-circumvention laws;
- we will tell third parties so if they complain.

[[COUNSEL: review this wording.]]

## `/.well-known/security.txt`

```text
Contact: mailto:[[SECURITY CONTACT]]
Expires: [[EXPIRY — within 1 year, ISO 8601, e.g. 2027-10-17T00:00:00Z]]
Policy: https://shots.playbookmedia.io/security/disclosure
Preferred-Languages: en
Canonical: https://shots.playbookmedia.io/.well-known/security.txt
```
