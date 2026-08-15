# Deployment

## Recommended host: Fly.io

Use Fly.io for the first production deployment. This app needs a normal Node.js
server for Sharp, Prisma, and API routes. Start production with a 1 GB shared
CPU machine. It costs about $5.92/month in Fly's base-priced region and gives
Sharp enough working memory for normal screenshots. Production runs one
always-on Machine in IAD and LAX, for about $12.53/month before database,
storage, and egress costs. It gives US users a nearby editor without cold
starts. DigitalOcean App Platform costs $10/month for fixed 1 GB; Railway costs
about $30/month for 1 GB plus one always-on vCPU. A 512 MB Fly machine costs
about $3.32/month, but use it only for development or low-resolution exports.

Cloud Run can cost less at very low traffic because it bills for use, but it
scales to zero by default. Use it only when cold starts are acceptable. Use a
Kubernetes deployment only after the app needs a cluster for other workloads.

## Deploy to Fly.io

1. Install and sign in to `flyctl`.
2. Change `app` in `fly.toml` to an unused name, then run:

   ```sh
   fly launch --no-deploy
   fly secrets set DATABASE_URL='postgresql://...' AUDIT_RETENTION_DATABASE_URL='postgresql://...' BETTER_AUTH_SECRET='...' BETTER_AUTH_URL='https://app.example.com' BETTER_AUTH_TRUSTED_ORIGINS='https://app.example.com' AUDIT_IP_HASH_SECRET='...' AUDIT_DRAIN_ENCRYPTION_KEY='...' AUTH_EMAIL_WEBHOOK_URL='https://mailer.example.com/auth' R2_ACCOUNT_ID='...' R2_ACCESS_KEY_ID='...' R2_SECRET_ACCESS_KEY='...' R2_BUCKET_NAME='...' CLEANUP_SECRET='...'
   fly deploy
   for region in iad lax; do
     fly scale count 1 --process-group app --region "$region" --yes
   done
   ```

   The database and R2 values are optional for the core editor but required for
   cached website captures. Do not place secrets in `fly.toml`.
   The regions are US East and US West. The GitHub deployment workflow
   maintains the same regional fleet on every release.

3. For CI/CD, create a deploy token and store it as the `FLY_API_TOKEN` GitHub
   Actions secret:

   ```sh
   fly tokens create deploy -a <app-name> -x 720h
   ```

4. If you use PostHog or R2 asset rewrites, set these GitHub Actions variables:
   `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`, and
   `NEXT_PUBLIC_R2_PUBLIC_URL`. The workflow passes them as build arguments.
   For a manual release, use:

   ```sh
   fly deploy --build-arg NEXT_PUBLIC_POSTHOG_KEY='...' --build-arg NEXT_PUBLIC_POSTHOG_HOST='...' --build-arg NEXT_PUBLIC_R2_PUBLIC_URL='...'
   ```

   With `NEXT_PUBLIC_R2_PUBLIC_URL` set, the image omits local copies of the
   background collections. Make sure the bucket contains those files first.

## Add a support environment

Create a GitHub Environment named `support`. Add its `FLY_API_TOKEN` secret,
then set `FLY_APP` to its Fly app name and `FLY_REGIONS` to its space-separated
region list, for example `iad`. Set the public build variables there too if the
support app needs them. Run **Deploy to Fly.io** manually and enter `support`.

No workflow change is needed for another environment: create its GitHub
Environment, add the same secret and variables, then enter its name when you
run the workflow. The automatic release path always deploys `production`.

## Releases

Release Please reads Conventional Commit messages merged into `main`. It opens
one version and changelog pull request, enables its auto-merge, then creates a
Git tag and GitHub Release when that pull request merges.

Before the first release, create a fine-grained GitHub token that can write
repository contents and pull requests. Store it as the `RELEASE_PLEASE_TOKEN`
repository secret. Do not use the default `GITHUB_TOKEN`: release-created
commits and tags must start the Fly.io and Trigger.dev workflows.

In GitHub branch protection for `main`, require the `CI` and `Commitlint`
checks, enable auto-merge, and allow the token owner to bypass neither rule.
The release pull request then merges only after the same required checks pass.

## Docker

```sh
docker build -t screenshot-studio .
docker run --rm -p 3000:3000 screenshot-studio
curl --fail http://localhost:3000/api/health
```

The image runs as UID 1001 and starts the Next.js standalone server on port
3000. `DATABASE_URL` has a build-only default because Prisma generation runs
during the image build; use a real value at runtime only when caching is on.

Production authentication and audit logging require the values in
[authentication and enterprise access](authentication.md). Use a separate
PlanetScale database role for `AUDIT_RETENTION_DATABASE_URL`; the web app role
must not update or delete audit records.

## Database migrations

Apply the reviewed Prisma migration to the PlanetScale development branch
before deploying code that depends on it:

```sh
npm run db:migrate:status
npm run db:migrate:deploy
```

Use `npm run db:push` only for the disposable local Compose database. Do not
use it against PlanetScale or any production environment. Record the target
branch, migration name, operator, and result in the release record.

## Kubernetes

```sh
helm upgrade --install screenshot-studio charts/screenshot-studio \
  --namespace screenshot-studio --create-namespace \
  --set image.repository=ghcr.io/playbookmediallc/screenshot-studio \
  --set image.tag=<image-tag>
```

Create a Secret with the optional keys described in
`charts/screenshot-studio/values.yaml`, then set `existingSecret` to its name.
Set `REDIS_URL` whenever the screenshot API route is enabled. Configure Ingress
or Gateway API through the existing `ingress` or `httpRoute` values.

## Cost sources

- [Fly.io pricing](https://fly.io/docs/about/pricing/)
- [Railway pricing](https://docs.railway.com/pricing/plans)
- [DigitalOcean App Platform pricing](https://www.digitalocean.com/pricing/app-platform)
- [Cloud Run pricing](https://cloud.google.com/run/pricing)
