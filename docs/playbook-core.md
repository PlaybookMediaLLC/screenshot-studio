# Playbook Core: the organization control plane

The backend in this repository is **Playbook Core**, the control plane for
every PlaybookMedia product. Screenshot Studio is the first web shell on top of
it. Other repositories (Wanta, OpenWhispr, bb, Steel, OpenScreen, Kaneo,
OpenConnector) are shells or execution engines. They are never an
organization authority.

> One organization ID. One membership system. One permission system. One
> company graph. One audit trail. Many shells and execution engines.

## What Core owns

Identity, sessions, organizations and switching, members, invitations, roles,
permissions, SSO and SCIM, entitlements, workspace settings, capability flags,
audit records, support grants, product surfaces, releases, campaigns, and
connection ownership all live here. They use the existing models: `User`,
`Session`, `Organization`, `Member`, `Invitation`, `WorkspaceSettings`,
`WorkspaceEntitlement`, `OrganizationEnterpriseSettings`, `SsoProvider`,
`ScimProvider`, `AuditLog`, `SupportAccessGrant`, `WorkspaceDeletion`,
`ProductSurface`, `Release`, and `Campaign`.

There is exactly one authorization path, `lib/auth/access.ts`:

1. authenticate the session or API key
2. resolve `Session.activeOrganizationId` (`resolveActiveOrganizationId`)
3. load the `Member` row for that organization
4. normalize the role
5. check the permission (`hasPermission`)
6. check the workspace is operational (`isWorkspaceOperational`)
7. build the tenant context
8. run the domain mutation in `lib/tenant` or `lib/workspace`
9. append an `AuditLog` entry in the same transaction

Client-side permission state is a rendering hint. **Client permissions control
presentation; server permissions control security.** A shell that receives a
401 or 403 refreshes its bootstrap.

## Code layout

| Path | Role |
| --- | --- |
| `lib/auth/*` | principals, sessions, RBAC |
| `lib/workspace/*` | organization, member, and settings lifecycle |
| `lib/tenant/*` | tenant-owned business domains |
| `lib/core/*` | cross-domain control-plane services (bootstrap, capabilities) |
| `app/api/v1/*` | the versioned shell and tenant API |
| `app/api/internal/*` | service API |
| `app/api/webhooks/*` | external event ingress |
| components and app routes | shell UI only |

Route handlers adapt HTTP onto these services. They never re-implement
business rules.

## Three API classes

| Class | Prefix | Callers | Authentication |
| --- | --- | --- | --- |
| Shell and user | `/api/v1/*` | web, Wanta, OpenWhispr, CLI, mobile | user session, or an organization API key for tenant routes |
| Internal service | `/api/internal/*` | workers, bb and Kaneo adapters, orchestration | service secret, never a browser session |
| Webhooks | `/api/webhooks/*` | GitHub, connectors, billing | per-provider signature and idempotent ingestion |

Inside `/api/v1`, shell routes (`me`, `bootstrap`, `organizations/*`) describe
a signed-in user. They refuse API keys. Tenant routes (`releases`,
`source-apps`, `assets`) also accept organization API keys with a scope. The
web app may also use tRPC (`/api/trpc`), which lives in the same codebase.
External shells must not depend on tRPC procedure names.

## Shell endpoints

| Endpoint | Permission | Returns |
| --- | --- | --- |
| `GET /api/v1/me` | session | the signed-in user |
| `GET /api/v1/bootstrap` | `workspace:read` in the active organization | the full `PlaybookBootstrap` |
| `GET /api/v1/organizations` | session | the user's memberships and roles |
| `GET /api/v1/organizations/:id` | `workspace:read` | organization identity |
| `GET /api/v1/organizations/:id/members` | `member:read` | members and roles |
| `GET /api/v1/organizations/:id/invitations` | `invitation:read` | invitations |
| `GET /api/v1/organizations/:id/settings` | `workspace:read` | locale, time zone, publish time |
| `GET /api/v1/organizations/:id/permissions` | `workspace:read` | role and resolved permissions |
| `GET /api/v1/organizations/:id/capabilities` | `workspace:read` | capabilities and the safe entitlement view |
| `POST /api/v1/organizations/:id/activate` | membership | switches the active organization, returns a fresh bootstrap |

`:id` routes act on the **active** organization only. To read another
organization, a shell activates it first. `activate` delegates to
`setActiveWorkspace`, which checks membership and deletion state the same way
the web switcher does.

The bootstrap shape is defined in `lib/core/bootstrap-shape.ts`. It is built
by copying named fields only, so connector secrets, OAuth tokens, browser
profiles, billing provider ids, and infrastructure details cannot leak into it.
Capabilities without a connected execution engine report `false`. Today that
is browser automation, voice capture, the engineering agent, and workflows.
`publishing` is true once the organization has an active channel connection.

Every shell request logs one structured line, `event:
playbook.shell_request`, with the route, status, latency, and the
`X-Playbook-Client` label (`web`, `wanta`, `openwhispr`, `cli`). The label is
for metrics only and never affects authorization.

## Ownership rules for other repositories

- **Wanta** (desktop shell): signs in, calls `GET /api/v1/bootstrap`, and
  renders the organization, switcher, role, and counters. Every durable edit
  goes through Core. Wanta keeps no local members, roles, invitations, billing,
  company graph, tasks, or customers.
- **OpenWhispr** (voice capture): knows the user id, the active organization,
  and the current product, customer, or campaign context. It delivers
  versioned capture artifacts to Core. It never syncs the organization
  database.
- **bb** (engineering runtime): receives a bounded, Core-authorized job:
  organization id, actor, run id, authorized repository, task, context packet,
  and constraints. Nothing else.
- **Steel** (browser runtime): receives bounded browser jobs: organization id
  for correlation, operation id, a profile reference, allowed domains,
  permission mode, and a validated plan. Steel never decides who is an admin.
- **OpenScreen** (rendering): receives render jobs. Core owns which
  organization owns the inputs and outputs.
- **OpenConnector**: owns OAuth credentials and provider execution. Core owns
  which organization owns a connection, who may use it, and its audit and
  approval state. Credentials never enter bootstrap or organization records.
- **Kaneo**: may model workspaces internally. Core stores the mapping. A Kaneo
  admin is not a Playbook admin.

The system is online-first and centrally authoritative. All collaborative
edits flow shell → Core API → membership and permission check → mutation →
`AuditLog`. The same mutation produces the same audit record whichever shell
called it.

## Product connection and the first campaign

A workspace connects its product as one or more `ProductSurface` rows: name,
URL, and `environment` (`production`, `staging`, `demo`, or `development`). A
`Release` holds the brief: title, benefit, plain-text description, audience,
and source links. It can be anchored to a surface. A `Campaign` links its
release and surface and always starts as `DRAFT`. A draft may have no angles
or posts. Copy is required only to enter `READY_FOR_REVIEW`.

Campaign status changes go through the table in
`lib/tenant/campaign-status.ts`, never inferred from filled fields.
Generation and publishing are job states, not campaign states. Editing a
release brief (`release.update`) changes only the brief. Campaigns, angles,
posts, and variants stay intact. Release and surface links use `ON DELETE SET
NULL`, so history survives deletion.

The campaign pages (`/campaigns`) are behind the `campaign:workflow` rollout
flag. Design-partner workspaces get it through
`WorkspaceEntitlement.featureOverrides`:

```sql
INSERT INTO workspace_entitlement ("organizationId", "featureOverrides", "updatedAt")
VALUES ('<organization id>', '{"campaign:workflow": true}', now())
ON CONFLICT ("organizationId") DO UPDATE
SET "featureOverrides" = COALESCE(workspace_entitlement."featureOverrides", '{}'::jsonb)
  || '{"campaign:workflow": true}'::jsonb;
```

`PLATFORM_CAMPAIGN_WORKFLOW=enabled` turns it on for every workspace in an
environment. The local Compose stack sets it by default. Existing campaigns are
never seeded or rewritten by the rollout.

Product analytics events (PostHog) are `product_surface_created`,
`release_created`, `campaign_draft_created` (with `elapsedSeconds` since the
form opened), and `campaign_opened`. The audit trail records
`product.surface_created`, `product.release_created`,
`product.release_updated`, `product.campaign_created`, and
`product.campaign_status_changed`. `product.campaign_created` carries
`workspaceAgeSeconds`, and the earliest one per organization is the time from
workspace creation to the first campaign draft.
