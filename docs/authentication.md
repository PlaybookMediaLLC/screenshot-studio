# Authentication and enterprise access

Screenshot Studio uses Better Auth with PlanetScale Postgres. The application
uses the Better Auth organization ID as the tenant ID.

## Required production configuration

Set these server-only values in the deployment secret store:

```text
DATABASE_URL
AUDIT_RETENTION_DATABASE_URL
BETTER_AUTH_SECRET
BETTER_AUTH_URL
BETTER_AUTH_TRUSTED_ORIGINS
AUDIT_IP_HASH_SECRET
AUDIT_DRAIN_ENCRYPTION_KEY
AUTH_EMAIL_WEBHOOK_URL
```

`AUDIT_RETENTION_DATABASE_URL` must use a separate database role. The web app
role can read and insert audit rows but must not update or delete them. The
retention worker role can delete only expired audit rows.

Set `NEXT_PUBLIC_APP_URL` to the public application URL. It is safe for the
browser. Do not expose any other value in this list.

Email/password sign-up needs `AUTH_EMAIL_WEBHOOK_URL`. It receives a JSON
object with `to`, `subject`, and `text`; connect it to the approved email
delivery service. Set the Google, Microsoft, and GitHub client ID and secret
pairs to enable those sign-in methods.

Set `BETTER_AUTH_API_KEY`, and optionally `BETTER_AUTH_API_URL` and
`BETTER_AUTH_KV_URL`, to enable Better Auth Infrastructure audit capture for
authentication and identity-provider events.

## Authorization

The fixed organization roles are owner, admin, creator, approver, publisher,
and viewer. Better Auth uses an internal `member` role only as a
viewer-equivalent default for SSO and SCIM provisioning.

Every server operation must resolve a request principal and then check the
organization membership and named permission. Organization API keys can only
use these scopes:

```text
release:create, source:write, asset:write, upload:sign, artifact:read
```

They cannot manage users, SSO, SCIM, drains, retention, or publishing.

## Enterprise identity

SSO supports OIDC and SAML through Better Auth. SCIM tokens are
organization-scoped and stored as hashes. A billing or entitlement service
must set `OrganizationEnterpriseSettings.ssoEnabled` or `.scimEnabled` before
an owner can configure that feature. The auth route rejects unentitled setup
requests and requires a fresh TOTP-protected owner or admin session.

SCIM deprovisioning is handled by Better Auth. Product workers must re-read
membership and approval state before they run a capture or publish action.

## Audit logs and SIEM drains

`AuditLog` is the product system of record. It stores a redacted, tenant-scoped
event for governance and product actions. The audit API supports filter and
search by time range, action, actor, outcome, entity type, and controlled text.

Use these APIs from the enterprise settings UI:

```text
GET  /api/audit-logs?organizationId=...&search=...&cursor=...
GET  /api/enterprise/audit-drains?organizationId=...
POST /api/enterprise/audit-drains
DELETE /api/enterprise/audit-drains/:drainId?organizationId=...
GET  /api/enterprise/audit-retention?organizationId=...
PUT  /api/enterprise/audit-retention
```

Drain events use CloudEvents JSON. Generic endpoints receive an HMAC SHA-256
signature. Splunk presets use a HEC token and Datadog presets use a Datadog API
key. Secrets are encrypted at rest, shown to no API consumer, and never added
to audit metadata or logs. Trigger.dev retries delivery without blocking the
customer action.

The retention task runs daily. Standard retention is 90 days. Enterprise
tenants can set a longer retention period or place their audit history on legal
hold.
