# Deployment

Production runs on DigitalOcean App Platform at `shots.playbookmedia.io`
(`shots.oppulence.io` redirects there; see `lib/canonical-host.ts`). The
[DigitalOcean deployment guide](digitalocean-deployment.md) documents the live
components, secrets, migration jobs, health checks, and release procedure.

The web and combined backend images are built on GitHub and stored in the
public GitHub Container Registry package. App Platform selects each image with
a unique commit SHA tag. The backend
container runs the social API, social Temporal worker,
tenant publishing worker, and six maintenance schedules as one service.

The `Web image` and `Social backend image` GitHub workflows publish their
respective images when relevant code lands on `main`. Their manual `deploy`
inputs load production secrets from Infisical using GitHub OIDC, validate the
live app topology, and update the corresponding App Platform components.
Deploy the backend before the web: its image carries the schema migrations, and
the web deploy refuses a topology that still has `web-migrate`. The Fly
deployment workflow and configuration have been removed.

All work PRs target `develop`. Release Please reads its Conventional Commits
and opens version/changelog PRs into `develop`, without publishing a release.
An intentional `develop` → `main` PR releases those changes. Use a merge commit
to preserve ancestry. The promotion publishes the prepared GitHub Release and
triggers the existing production workflows; `develop` never deploys production.
The `RELEASE_PLEASE_TOKEN` secret lets generated preparation PRs trigger CI;
without it, a human must reopen the generated PR to start checks. See
[branching and releases](branching-and-releases.md) for repository rules,
tag behavior and the complete procedure.

App Platform runs one `platform-migrate` predeploy job from the backend image.
It applies product and social migrations to the same PostgreSQL database and
`public` schema. The web has no database connection. Review the migration
sources in `server/platformmigrations/sql` and
`server/internal/social/migrations` and the
database backup before changing the backend image.

For a local web image smoke test:

```sh
docker build -t screenshot-studio .
docker run --rm -p 3000:3000 screenshot-studio
curl --fail http://localhost:3000/api/health
```
