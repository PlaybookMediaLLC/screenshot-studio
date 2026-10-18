# API, Agent, and MCP Terms (draft)

> **DRAFT — requires counsel review.** Not legal advice. Do not publish. Shots has no API terms
> today. Code baseline: commit `bad06b3e`.

## Summary

- Shots publishes an OpenAPI 3.1 contract, an API reference, `llms.txt`, and Markdown versions of
  pages for agents.
- API keys belong to a workspace and have limited scopes. No key can approve or publish.
- The customer is responsible for every call that its keys and agents make.
- No official MCP server or CLI is published today. These terms cover them if they ship.

## Facts from the code

| Topic          | Behavior                                                                                  |
| -------------- | ----------------------------------------------------------------------------------------- |
| Key scopes     | `release:create`, `source:write`, `asset:write`, `upload:sign`, `artifact:read`           |
| Key storage    | Hashed at rest, shown once, prefix `ss_`                                                  |
| Key rate limit | 60 requests a minute for each key by default                                              |
| Write quota    | A per-minute API write allowance for each plan                                            |
| MCP and CLI    | The developer page says that none is published                                            |
| Discovery      | `/openapi.json`, `/api-reference`, `/llms.txt`, `/llms-full.txt`, `Accept: text/markdown` |

---

## Proposed text

**API Terms**

Version `[[VERSION]]`. Effective `[[EFFECTIVE DATE]]`.

These terms are part of the [Terms of Service](terms-of-service.md). They apply to the Shots API,
its webhooks, its machine-readable files, and any MCP server or CLI that we publish.

### 1. Access

1. You need an active paid plan to use the API.
2. A workspace owner or admin creates API keys. Each key has the scopes that the owner chooses.
3. No key can approve or publish a post. Those actions need a person.

### 2. Your responsibilities

1. Keep keys secret. Do not put them in public code or in browser code.
2. Revoke a key at once if it leaks.
3. You are responsible for every call made with your keys, including calls by scripts and AI agents.
4. Do not give an agent more scopes than it needs.
5. Follow the [Acceptable Use Policy](acceptable-use-policy.md).

### 3. Limits

1. Respect the rate limits and quotas in the API responses and on the pricing page.
2. Do not try to go around limits, for example with many keys or many workspaces.
3. We can change limits. We give notice for changes that reduce limits on a paid plan.
   `[[NOTICE PERIOD]]`

### 4. Changes to the API

1. We version the API contract. We give at least `[[DEPRECATION NOTICE]]` notice before we remove
   a stable endpoint.
2. Endpoints marked beta can change without notice.

### 5. Webhooks

1. Verify the signature on every webhook that you receive from us.
2. Signed webhooks that you send to us must use the secret that the workspace sets.

### 6. Agent and crawler access

1. Agents can read the public pages, `llms.txt`, and the API reference.
2. Do not use automated tools to create accounts, to scrape customer content, or to test security
   outside the [Responsible Disclosure policy](responsible-disclosure.md).

### 7. Suspension

We can revoke a key or suspend API access if a key is used against these terms, if it puts the
service at risk, or if the law requires it.

### 8. No extra warranty

The API is part of the service. The warranty and liability terms of the Terms of Service apply.
