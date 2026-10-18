# Responsible Disclosure and security.txt (draft)

> **DRAFT — requires counsel review.** Not legal advice. Do not publish. Shots has no disclosure
> policy and no `/.well-known/security.txt` today. The Security page tells researchers to use the
> contact page. Code baseline: commit `bad06b3e`.

## Summary

- Researchers need one clear address and clear rules.
- Safe harbor language protects good-faith research.
- `security.txt` (RFC 9116) lets tools find the address. Product change P7 publishes it.

---

## Proposed text

**Responsible Disclosure**

Version `[[VERSION]]`. Effective `[[EFFECTIVE DATE]]`.

### 1. Report a vulnerability

Email `[[SECURITY EMAIL]]`. Include the steps to reproduce, the affected address or component, and
the impact. Do not open a public issue.

### 2. What we do

1. We confirm that we received your report within `[[ACK TIME]]`.
2. We tell you our assessment and our plan.
3. We tell you when we fix the issue. We credit you if you want.

### 3. Rules for research

1. Test only against your own account and your own workspace.
2. Do not access, change, or delete data of other users. If you reach it by accident, stop and tell
   us.
3. Do not use denial of service, spam, social engineering, or physical attacks.
4. Do not test third-party services that Shots connects to, such as social networks, Stripe, or
   AI providers.
5. Give us reasonable time to fix the issue before you disclose it. `[[DISCLOSURE PERIOD]]`

### 4. Safe harbor

If you follow these rules in good faith, we will not take legal action against you for your
research, and we will not ask law enforcement to act. `[[COUNSEL: confirm scope]]`

### 5. Rewards

We do not run a paid bug bounty today. `[[UPDATE if a bounty starts]]`

---

## Proposed `security.txt`

Serve at `https://shots.playbookmedia.io/.well-known/security.txt` (product change P7).

```text
Contact: mailto:[[SECURITY EMAIL]]
Expires: [[DATE LESS THAN ONE YEAR AHEAD, ISO 8601]]
Policy: https://shots.playbookmedia.io/[[DISCLOSURE POLICY PATH]]
Preferred-Languages: en
Canonical: https://shots.playbookmedia.io/.well-known/security.txt
```
