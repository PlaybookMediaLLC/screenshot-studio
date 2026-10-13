# Screenshot Studio on DigitalOcean App Platform

> **Draft deployment guard:** The live app has design-renderer, Postiz, and
> publishing components that this draft spec does not yet contain. The caller
> workflow is disabled until the full live topology is represented and
> `SCREENSHOT_STUDIO_FULL_SPEC_READY=true` is set in GitHub repository variables.
> Updating the app from this partial spec would remove live components.

The production App Platform app serves `shots.oppulence.io`. The separate
`www.screenshot-studio.com` Vercel deployment is outside this migration.

The [app spec](screenshot-studio-production.yaml) runs one GitHub-built image
as two 1 GiB web instances, a private publishing API, a private Temporal
orchestrator, and a pre-deploy Prisma migration job in NYC. A separate private
1 GiB Supabase Storage service uses a pinned public Docker Hub image.
GitHub Actions builds Linux AMD64 images and pushes them to the public
`ghcr.io/playbookmediallc/screenshot-studio` package. DigitalOcean pulls an
immutable digest; it does not build the application. This partial spec alone
would cost $60/month for always-on instances before bandwidth, job execution,
or other usage: $24 web, $12 storage, $12 publishing API, and $12 orchestrator.
The live app has additional services and DigitalOcean currently estimates
$102–$126/month before the pending storage tier change.

## Initial setup

1. Publish an initial image to the public GHCR package. Check that an
   anonymous pull of its digest succeeds. The initial image was built by
   [GitHub Actions run 38328935645](https://github.com/PlaybookMediaLLC/screenshot-studio/actions/runs/38328935645).
2. Create an App Platform app in the same DigitalOcean team from that digest.
   Match the service configuration in `screenshot-studio-production.yaml` and
   assign it to the Solomon-AI project. Keep its generated
   `ondigitalocean.app` URL until it responds successfully at `/api/health`.
3. Create a DigitalOcean API token with `actions:read`, `regions:read`,
   `sizes:read`, `app:read`, and `app:update` scopes. Store it in the
   `PlaybookMediaLLC/screenshot-studio` GitHub repository as the
   `DIGITALOCEAN_PRODUCTION_TOKEN` Actions secret. Store the app UUID as the
   `SCREENSHOT_STUDIO_APP_ID` repository variable. Restrict the `production`
   GitHub Environment to `main`.
4. Run `.github/workflows/deploy-app-platform.yml` manually on `main`. It
   calls the public, SHA-pinned Oppulence reusable workflow. Check the new
   deployment, its digest, and `/api/health` on the DigitalOcean URL.
5. Add `shots.oppulence.io` to the App Platform app and replace the Fly A/AAAA
   records in Cloudflare with a DNS-only CNAME to the App Platform starter
   domain. DigitalOcean issues and renews the domain certificate. Check HTTPS,
   `/api/health`, authentication, and tenant storage before retiring the Fly
   Machines. The production hostname now points to DigitalOcean.

The committed spec uses `ci-placeholder` for the components and migration job
built from this repository. The reusable workflow replaces every placeholder
with the same image digest. Do not apply the template directly. The storage
image has its own pinned digest. Before editing the spec after secrets or
domains are configured, export the live app spec and preserve its encrypted
`EV[...]` values and domain settings. The shared workflow validates secret
values but does not detect omitted secrets.

The deployment workflow can authenticate to Infisical with GitHub OIDC. Its
source is the `Desktop App Backend` project, `prod` environment, and a
dedicated `/screenshot-studio` folder. The repository variables
`SCREENSHOT_STUDIO_INFISICAL_IDENTITY_ID` and
`SCREENSHOT_STUDIO_INFISICAL_PROJECT_ID` identify that binding. The production
identity is `9747a048-efe0-4c7e-80c1-761221c9544a`; it has project-level
No Access and read access to `/screenshot-studio` in `prod`. Its OIDC subject
uses GitHub's immutable repository IDs and its `ref` claim requires `main`.
Runtime secret entries in the app spec can
use `type: SECRET` and `value: infisical://KEY`; the shared workflow resolves
them in the runner and submits encrypted values to DigitalOcean. Infisical
rotations require another deployment. The existing root secrets in `Desktop
App Backend` belong to other services; do not expose that root folder to this
identity. The dedicated folder and identity are configured. The folder holds
the scoped web and storage database URLs, R2 credentials, app signing secrets,
provider credentials, the migration owner URL, and the Screenshot Studio
Temporal address, namespace, and API key. The migration owner URL is used only
by the pre-deploy job. The six OAuth, Resend, and Redis credentials match the
running Fly service; `BETTER_AUTH_SECRET` also matches Fly to preserve sessions.
The GitHub production identity can read this entire folder, so keep its branch
and environment restrictions in place.

## Runtime services

The current Fly web app embeds its runtime variables in the machine environment;
`flyctl secrets list` alone does not show them. The DigitalOcean spec supplies
the required values from Infisical and routes storage over
`${storage.PRIVATE_URL}`. The private Storage service uses the existing
PlanetScale `storage` database and Cloudflare R2 `screenshot-studio` bucket.
The web role has schema usage and full DML on all 54 current application tables;
the storage role has the same on all 10 storage tables and membership in the
four Supabase request roles. Default privileges cover future tables created
by the migration owner. Both scoped URLs were connected and checked directly.
The `PRE_DEPLOY` job runs Prisma migrations with the owner URL before the new
image receives traffic.

The Go publishing backend and orchestrator use the dedicated Screenshot Studio
Temporal Cloud namespace. The orchestrator is the only scheduled-post dispatcher
in this deployment. Do not deploy the separate Trigger.dev dispatcher against
the same production tables: both could claim and publish posts. The Trigger.dev
GitHub integration is disconnected. Audit, outbox, cleanup, and design rendering
still need their own execution plan and verification.
