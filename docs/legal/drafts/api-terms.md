# API Terms — DRAFT

> **DRAFT — requires counsel review.** Not legal advice. Not published. When adopted, the
> OpenAPI document's `termsOfService` (`lib/api/openapi.ts`) should point here.
> [[COUNSEL: the OpenAPI document labels the API "Apache-2.0". Decide whether that licence
> label is intended for the API itself, or only for the open-source code.]]

## Summary

- The Shots API (`/api/v1`) lets your systems create releases, upload assets, read artifacts
  and preview links for your workspace.
- Keys belong to your workspace. Keep them secret. You are responsible for every call made
  with them.
- Keys can't approve or publish posts. A person does that in the app.
- Respect the rate limits. These Terms add to the [Terms of Service](/terms).

**Effective:** [[EFFECTIVE DATE]]

## 1. Keys and scopes

- Workspace owners and admins create API keys (`ss_…`) in Settings → Developer API. A key is
  shown once and stored as a hash.
- Each key has one or more of these scopes:
  - `artifact:read`
  - `asset:write`
  - `release:create`
  - `source:write`
  - `upload:sign`
- Give each key only the scopes it needs. [[PRODUCT: stop defaulting keys to all scopes]]
- Revoke a key at once if it may be exposed. Revocation applies on the next request.

## 2. Limits

- Each key is limited to 60 requests a minute. Some endpoints have their own limits, for
  example link preview (60 a minute) and screenshots (20 a minute).
- Plan allowances and credits apply to API use just as they do in the app.
- Don't try to get around limits, for example by spreading load across several keys.
- We may change limits. We will give 30 days' notice of any reduction that affects documented
  limits, unless it is needed to protect the Service.

## 3. Acceptable use

- The [Acceptable Use Policy](/acceptable-use) applies.
- Through the API, you may not:
  - crawl or capture sites you have no right to access;
  - use crawler user-agent options to impersonate a search engine or social-network bot,
    except for pages you control;
  - use the API to build a competing product.

## 4. Agents and MCP clients

- If you connect an AI agent or an MCP client to Shots, it acts with your key's scopes, and you
  are responsible for its actions.
- Agents can create and submit drafts. They cannot approve or publish. [[PRODUCT: close the
  legacy social backend's public API and MCP routes, which can publish]]

## 5. Changes and deprecation

- The API is versioned (`/api/v1`). We try not to make breaking changes within a version. We
  will give at least [[e.g. 90]] days' notice before removing a v1 endpoint or field, unless
  security or the law requires faster action.
- Changes are published in the [API reference](/api-reference) and the changelog.

## 6. Suspension

We may suspend a key that threatens the Service, breaks these Terms, or appears compromised. We
will tell the workspace admins.

## 7. No warranty

The API is part of the Service. The disclaimers and limitation of liability in the
[Terms of Service](/terms) apply. There is no API SLA unless an order form provides one.
