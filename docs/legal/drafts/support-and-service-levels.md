# Support and Service Levels (draft)

> **DRAFT — requires counsel review.** Not legal advice. Do not publish. Shots has no support or SLA
> policy today. Code baseline: commit `bad06b3e`.

## Summary

- Pro and Business plans get email support and no uptime commitment.
- Enterprise plans can get a service level through an order form.
- Publishing depends on social networks. Their outages do not count against a service level.

## Facts from the code

1. The application has one backend instance and two web instances in one region. `[[CONFIRM]]`
2. A status page is not in the code. `[[STATUS PAGE URL, if one exists]]`
3. The contact page lists one email address for bugs, feature requests, and general questions.

## Recommendation

Do not offer a numeric uptime target on self-serve plans until monitoring, a status page, and an
on-call process exist. Offer an Enterprise SLA only by order form.

---

## Proposed text

**Support and Service Levels**

Version `[[VERSION]]`. Effective `[[EFFECTIVE DATE]]`.

### 1. Support

| Plan       | Channel                   | Hours                    | First response target          |
| ---------- | ------------------------- | ------------------------ | ------------------------------ |
| Pro        | Email `[[SUPPORT EMAIL]]` | `[[SUPPORT HOURS]]`      | `[[PRO RESPONSE TARGET]]`      |
| Business   | Email `[[SUPPORT EMAIL]]` | `[[SUPPORT HOURS]]`      | `[[BUSINESS RESPONSE TARGET]]` |
| Enterprise | As the order form states  | As the order form states | As the order form states       |

Response targets are goals, not guarantees.

### 2. Service levels

1. Pro and Business plans have no uptime commitment and no service credits.
2. An Enterprise order form can set an availability target, how we measure it, and service credits.
   `[[ENTERPRISE SLA TERMS]]`

### 3. What a service level does not cover

1. Outages, API changes, rate limits, or rejections by social networks, app stores, Slack, Notion,
   Figma, GitHub, or other services that you connect.
2. Outages of AI model providers. AI features can be slower or unavailable while a provider is down.
3. Scheduled maintenance that we announce at least `[[MAINTENANCE NOTICE]]` in advance.
4. Problems that your network, browser, identity provider, or misuse cause.
5. Beta features.

### 4. Status and incidents

We post incidents at `[[STATUS PAGE URL]]`. For a personal data breach, the
[Data Processing Addendum](data-processing-addendum.md) applies.
